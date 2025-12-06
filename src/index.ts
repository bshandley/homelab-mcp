#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, validateConfig } from './config.js';
import { getToolsForLevel, getTool, initializeTools } from './tools/index.js';

async function main() {
  console.error('[Server] Starting Homelab MCP Server...');

  // Load and validate configuration
  const config = loadConfig();
  validateConfig(config);

  // Initialize tool handlers
  initializeTools(config);

  // Get tools for configured capability level
  const availableTools = getToolsForLevel(config.capabilityLevel);
  console.error(`[Server] Loaded ${availableTools.length} tools for capability level ${config.capabilityLevel}`);

  // Create MCP server
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

    // Check if tool is available at current capability level
    if (tool.level > config.capabilityLevel) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool ${toolName} requires capability level ${tool.level}, current level is ${config.capabilityLevel}`
      );
    }

    try {
      const result = await tool.handler(args, config);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(`[Tool] Error executing ${toolName}:`, error);

      // Return user-friendly error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: true,
                code: 'TOOL_EXECUTION_ERROR',
                message: errorMessage,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[Server] Homelab MCP Server running');
}

main().catch((error) => {
  console.error('[Server] Fatal error:', error);
  process.exit(1);
});
