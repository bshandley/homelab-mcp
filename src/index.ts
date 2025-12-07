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
import { URL } from 'url';
import { loadConfig, validateConfig } from './config.js';
import { getToolsForLevel, getTool, initializeTools } from './tools/index.js';
import {
  validateClientCredentials,
  validateClientId,
  validateAccessToken,
  issueToken,
  parseBasicAuth,
  parseRequestBody,
  parseFormUrlEncoded,
  createAuthorizationCode,
  validateAuthorizationCode,
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

    // Helper to get base URL
    const getBaseUrl = (req: IncomingMessage) => {
      const host = req.headers.host || 'mcp.handley.io';
      return `https://${host}`;
    };

    // Helper to send 401 with proper MCP auth headers (RFC 9728)
    const sendUnauthorized = (req: IncomingMessage, res: ServerResponse, requestId: string) => {
      const baseUrl = getBaseUrl(req);
      const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
      
      console.error(`[Auth] Authentication required, returning 401 with resource_metadata (${requestId})`);
      
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
      });
      res.end(JSON.stringify({
        error: 'unauthorized',
        message: 'Authentication required',
      }));
    };

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

      // Parse URL
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;
      const baseUrl = getBaseUrl(req);

      // Health check endpoint (no auth required)
      if (pathname === '/health' && req.method === 'GET') {
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

      // Favicon - return 204 No Content
      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      // OAuth 2.0 Protected Resource Metadata (RFC 9728) - Required by MCP spec
      if (pathname === '/.well-known/oauth-protected-resource' && req.method === 'GET') {
        console.error(`[OAuth] Serving protected resource metadata`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resource: baseUrl,
          authorization_servers: [baseUrl],
          scopes_supported: ['mcp'],
          bearer_methods_supported: ['header'],
        }));
        return;
      }

      // OAuth 2.0 Authorization Server Metadata (RFC 8414)
      if (pathname === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
        console.error(`[OAuth] Serving authorization server metadata`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/oauth/token`,
          registration_endpoint: `${baseUrl}/oauth/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256', 'plain'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
          scopes_supported: ['mcp'],
        }));
        return;
      }

      // OAuth 2.0 Dynamic Client Registration (RFC 7591)
      if (pathname === '/oauth/register' && req.method === 'POST') {
        if (!hasOAuth) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request', error_description: 'OAuth not configured' }));
          return;
        }

        try {
          const body = await parseRequestBody(req);
          const registration = JSON.parse(body);
          
          console.error(`[OAuth] Client registration request:`, JSON.stringify(registration));
          
          // Return the pre-configured client credentials
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            client_id: config.oauthClientId,
            client_secret: config.oauthClientSecret,
            client_name: registration.client_name || 'MCP Client',
            redirect_uris: registration.redirect_uris || [],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }));
          return;
        } catch (error) {
          console.error('[OAuth] Registration error:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_request' }));
          return;
        }
      }

      // OAuth 2.0 Authorization Endpoint
      if (pathname === '/authorize' && req.method === 'GET') {
        if (!hasOAuth) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'OAuth not configured' }));
          return;
        }

        const responseType = parsedUrl.searchParams.get('response_type');
        const clientId = parsedUrl.searchParams.get('client_id');
        const redirectUri = parsedUrl.searchParams.get('redirect_uri');
        const codeChallenge = parsedUrl.searchParams.get('code_challenge');
        const codeChallengeMethod = parsedUrl.searchParams.get('code_challenge_method') || 'plain';
        const state = parsedUrl.searchParams.get('state');
        const scope = parsedUrl.searchParams.get('scope');

        console.error(`[OAuth] Authorization request: client_id=${clientId}, redirect_uri=${redirectUri}, scope=${scope}`);

        // Validate required parameters
        if (responseType !== 'code') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'unsupported_response_type',
            error_description: 'Only code response type is supported',
          }));
          return;
        }

        if (!clientId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'invalid_request',
            error_description: 'client_id is required',
          }));
          return;
        }

        if (!redirectUri) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'invalid_request',
            error_description: 'redirect_uri is required',
          }));
          return;
        }

        if (!codeChallenge) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'invalid_request',
            error_description: 'code_challenge is required (PKCE)',
          }));
          return;
        }

        // Auto-approve for personal homelab
        const authCode = createAuthorizationCode(
          clientId,
          redirectUri,
          codeChallenge,
          codeChallengeMethod
        );

        // Build redirect URL with authorization code
        const redirectUrl = new URL(redirectUri);
        redirectUrl.searchParams.set('code', authCode);
        if (state) {
          redirectUrl.searchParams.set('state', state);
        }

        console.error(`[OAuth] Redirecting to: ${redirectUrl.toString()}`);

        res.writeHead(302, { 'Location': redirectUrl.toString() });
        res.end();
        return;
      }

      // OAuth 2.0 Token Endpoint
      if (pathname === '/oauth/token' && req.method === 'POST') {
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
          let code: string | undefined;
          let codeVerifier: string | undefined;
          let redirectUri: string | undefined;

          // Parse based on content type
          if (contentType.includes('application/x-www-form-urlencoded')) {
            const params = parseFormUrlEncoded(body);
            grantType = params.grant_type;
            clientId = params.client_id;
            clientSecret = params.client_secret;
            code = params.code;
            codeVerifier = params.code_verifier;
            redirectUri = params.redirect_uri;
          } else if (contentType.includes('application/json')) {
            const json = JSON.parse(body);
            grantType = json.grant_type;
            clientId = json.client_id;
            clientSecret = json.client_secret;
            code = json.code;
            codeVerifier = json.code_verifier;
            redirectUri = json.redirect_uri;
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

          console.error(`[OAuth] Token request: grant_type=${grantType}, client_id=${clientId}, code=${code ? 'present' : 'missing'}, code_verifier=${codeVerifier ? 'present' : 'missing'}`);

          // Handle Authorization Code grant
          if (grantType === 'authorization_code') {
            if (!code || !codeVerifier || !redirectUri || !clientId) {
              console.error(`[OAuth] Missing params: code=${!!code}, codeVerifier=${!!codeVerifier}, redirectUri=${!!redirectUri}, clientId=${!!clientId}`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'invalid_request',
                error_description: 'Missing code, code_verifier, redirect_uri, or client_id',
              }));
              return;
            }

            const validation = validateAuthorizationCode(code, clientId, redirectUri, codeVerifier);
            if (!validation.valid) {
              console.error(`[OAuth] Authorization code validation failed: ${validation.error}`);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'invalid_grant',
                error_description: validation.error,
              }));
              return;
            }

            // Issue token
            const tokenResponse = issueToken();
            console.error(`[OAuth] Token issued via authorization_code for client_id: ${clientId}`);

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Pragma': 'no-cache',
            });
            res.end(JSON.stringify(tokenResponse));
            return;
          }

          // Handle Client Credentials grant (for backward compatibility / testing)
          if (grantType === 'client_credentials') {
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
            console.error(`[OAuth] Token issued via client_credentials for client_id: ${clientId}`);

            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Pragma': 'no-cache',
            });
            res.end(JSON.stringify(tokenResponse));
            return;
          }

          // Unsupported grant type
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'unsupported_grant_type',
            error_description: 'Supported grant types: authorization_code, client_credentials',
          }));
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

      // MCP endpoint - handle discovery (GET) and protocol (POST)
      if (pathname === '/mcp' || pathname === '/') {
        // Check authentication for all MCP requests
        const authHeader = req.headers.authorization;
        let isAuthenticated = false;

        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          isAuthenticated = validateAccessToken(token, config);
        }

        // If not authenticated, return 401 with resource_metadata (per MCP spec)
        if (!isAuthenticated) {
          sendUnauthorized(req, res, requestId);
          return;
        }

        // Authenticated - handle the request
        if (req.method === 'GET') {
          // GET requests return server info
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            name: 'homelab-mcp',
            version: '1.0.0',
            protocol_version: '2024-11-05',
            capabilities: { tools: {} },
          }));
          return;
        }

        // POST requests - MCP protocol
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
      console.error(`[Server]   - Health:     http://0.0.0.0:${port}/health`);
      console.error(`[Server]   - Resource:   http://0.0.0.0:${port}/.well-known/oauth-protected-resource`);
      console.error(`[Server]   - Auth Meta:  http://0.0.0.0:${port}/.well-known/oauth-authorization-server`);
      console.error(`[Server]   - Register:   http://0.0.0.0:${port}/oauth/register`);
      console.error(`[Server]   - Authorize:  http://0.0.0.0:${port}/authorize`);
      console.error(`[Server]   - Token:      http://0.0.0.0:${port}/oauth/token`);
      console.error(`[Server]   - MCP:        http://0.0.0.0:${port}/mcp`);
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
