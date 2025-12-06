#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { loadConfig, validateConfig } from './config.js';
import { getToolsForLevel, getTool, initializeTools } from './tools/index.js';
import {
  validateClientCredentials,
  validateAccessToken,
  issueToken,
  parseBasicAuth,
  parseRequestBody,
  parseFormUrlEncoded,
} from './oauth.js';

async function main() {
  console.error('[Server] Starting Homelab MCP Server...');

  const config = loadConfig();
  validateConfig(config);
  initializeTools(config);

  const availableTools = getToolsForLevel(config.capabilityLevel);
  console.error(`[Server] Loaded ${availableTools.length} tools for capability level ${config.capabilityLevel}`);

  // Factory function to create configured MCP server
  function createMcpServer() {
    const server = new Server(
      {
        name: 'homelab-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Handle list_tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: availableTools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle call_tool request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = request.params.arguments || {};

      console.error(`[Tool] Calling: ${toolName}`);

      const tool = getTool(toolName);

      if (!tool) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${toolName}`);
      }

      if (tool.level > config.capabilityLevel) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool ${toolName} requires capability level ${tool.level}, current level is ${config.capabilityLevel}`
        );
      }

      try {
        const result = await tool.handler(args, config);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        console.error(`[Tool] Error executing ${toolName}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: true, code: 'TOOL_EXECUTION_ERROR', message: errorMessage }, null, 2),
          }],
          isError: true,
        };
      }
    });

    return server;
  }

  // Determine transport mode
  const useHttp = process.env.MCP_TRANSPORT === 'http' || !!config.port;

  if (useHttp) {
    // HTTP transport for remote access (Claude Chat)
    const port = config.port || 3000;

    // Check we have some form of authentication configured
    const hasApiKey = !!config.apiKey;
    const hasOAuth = !!(config.oauthClientId && config.oauthClientSecret);

    if (!hasApiKey && !hasOAuth) {
      console.error('[Server] ERROR: HTTP mode requires API_KEY or OAuth credentials');
      process.exit(1);
    }

    console.error(`[Server] Auth modes: API_KEY=${hasApiKey}, OAuth=${hasOAuth}`);

    // Track active transports for cleanup
    const activeTransports = new Map<string, StreamableHTTPServerTransport>();

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const requestId = Math.random().toString(36).substring(7);
      console.error(`[HTTP] ${req.method} ${req.url} (${requestId})`);

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check endpoint (no auth required)
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          version: '1.0.0',
          capabilityLevel: config.capabilityLevel,
          toolCount: availableTools.length,
          authModes: {
            apiKey: hasApiKey,
            oauth: hasOAuth,
          },
        }));
        return;
      }
      
      // OAuth 2.0 Authorization Server Metadata (RFC 8414)
      if (req.url === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
        const baseUrl = `https://${req.headers.host || 'mcp.handley.io'}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          issuer: baseUrl,
          token_endpoint: `${baseUrl}/oauth/token`,
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          grant_types_supported: ['client_credentials'],
          response_types_supported: ['token'],
          scopes_supported: ['mcp'],
        }));
        return;
      } 

      // OAuth 2.0 Token Endpoint
      if (req.url === '/oauth/token' && req.method === 'POST') {
        if (!hasOAuth) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'unsupported_grant_type',
            error_description: 'OAuth is not configured on this server',
          }));
          return;
        }

        try {
          const body = await parseRequestBody(req);
          const contentType = req.headers['content-type'] || '';

          let grantType: string | undefined;
          let clientId: string | undefined;
          let clientSecret: string | undefined;

          // Parse based on content type
          if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = parseFormUrlEncoded(body);
            grantType = params.grant_type;
            clientId = params.client_id;
            clientSecret = params.client_secret;
          } else if (contentType.includes('application/json')) {
            const json = JSON.parse(body);
            grantType = json.grant_type;
            clientId = json.client_id;
            clientSecret = json.client_secret;
          }

          // Also check Authorization header for Basic auth
          const authHeader = req.headers.authorization;
          if (authHeader && authHeader.startsWith('Basic ')) {
            const basicAuth = parseBasicAuth(authHeader);
            if (basicAuth) {
              clientId = clientId || basicAuth.clientId;
              clientSecret = clientSecret || basicAuth.clientSecret;
            }
          }

          // Validate grant type
          if (grantType !== 'client_credentials') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'unsupported_grant_type',
              error_description: 'Only client_credentials grant type is supported',
            }));
            return;
          }

          // Validate credentials
          if (!clientId || !clientSecret) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'invalid_request',
              error_description: 'Missing client_id or client_secret',
            }));
            return;
          }

          if (!validateClientCredentials(clientId, clientSecret, config)) {
            console.error(`[OAuth] Invalid credentials for client_id: ${clientId}`);
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'invalid_client',
              error_description: 'Invalid client credentials',
            }));
            return;
          }

          // Issue token
          const tokenResponse = issueToken();
          console.error(`[OAuth] Token issued for client_id: ${clientId}`);

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
          });
          res.end(JSON.stringify(tokenResponse));
          return;

        } catch (error) {
          console.error('[OAuth] Token endpoint error:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'server_error',
            error_description: 'Internal server error',
          }));
          return;
        }
      }

      // For all other endpoints, require authentication
      const authHeader = req.headers.authorization;
      let isAuthenticated = false;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        isAuthenticated = validateAccessToken(token, config);
      }

      if (!isAuthenticated) {
        console.error(`[Auth] Authentication failed (${requestId})`);
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="homelab-mcp"',
        });
        res.end(JSON.stringify({
          error: 'unauthorized',
          message: 'Invalid or missing access token',
        }));
        return;
      }

      // MCP endpoint
      if (req.url === '/mcp' || req.url === '/') {
        try {
          // Check for existing session
          const sessionId = req.headers['mcp-session-id'] as string | undefined;

          if (sessionId && activeTransports.has(sessionId)) {
            // Reuse existing transport for this session
            const transport = activeTransports.get(sessionId)!;
            await transport.handleRequest(req, res);
            return;
          }

          // Create new transport and server for new session
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => requestId,
          });

          const server = createMcpServer();

          // Handle transport close
          transport.onclose = () => {
            console.error(`[HTTP] Transport closed (${requestId})`);
            activeTransports.delete(requestId);
          };

          // Store transport
          activeTransports.set(requestId, transport);

          // Connect and handle
          await server.connect(transport);
          await transport.handleRequest(req, res);

        } catch (error) {
          console.error(`[HTTP] Error handling MCP request (${requestId}):`, error);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        }
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.error('[Server] Received SIGTERM, shutting down...');
      httpServer.close(() => {
        console.error('[Server] HTTP server closed');
        process.exit(0);
      });
    });

    httpServer.listen(port, '0.0.0.0', () => {
      console.error(`[Server] HTTP server listening on http://0.0.0.0:${port}`);
      console.error(`[Server] Endpoints:`);
      console.error(`[Server]   - Health: http://0.0.0.0:${port}/health`);
      console.error(`[Server]   - OAuth:  http://0.0.0.0:${port}/oauth/token`);
      console.error(`[Server]   - MCP:    http://0.0.0.0:${port}/mcp`);
      console.error(`[Server] Capability level: ${config.capabilityLevel}`);
    });

  } else {
    // Stdio transport for local access (Claude Desktop/Code)
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Server] Homelab MCP Server running (stdio mode)');
  }
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});
