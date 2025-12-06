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
    const apiKey = config.apiKey;

    if (!apiKey) {
      console.error('[Server] ERROR: API_KEY is required for HTTP transport');
      process.exit(1);
    }

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
          toolCount: availableTools.length
        }));
        return;
      }

      // API key authentication for all other endpoints
      const authHeader = req.headers.authorization;
      const expectedAuth = `Bearer ${apiKey}`;

      if (!authHeader || authHeader !== expectedAuth) {
        console.error(`[Auth] Invalid or missing API key (${requestId})`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Invalid or missing API key' }));
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
      console.error(`[Server] MCP endpoint: http://0.0.0.0:${port}/mcp`);
      console.error(`[Server] Health check: http://0.0.0.0:${port}/health`);
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
