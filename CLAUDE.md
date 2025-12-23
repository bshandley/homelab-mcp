# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server for managing homelab infrastructure. It provides Claude with tools to monitor and manage Docker containers, OPNsense firewall, TrueNAS storage, and Proxmox virtualization through a capability-based permission system.

## Build Commands

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Development mode (no build, uses tsx)
npm run dev

# Type check without building
npx tsc --noEmit

# Docker deployment
docker compose build
docker compose up -d
docker compose logs -f
```

## Architecture

### Transport Modes

The server supports two transport modes, selected automatically:

1. **stdio mode** (default): For local Claude Desktop/Code usage
   - Triggered when `PORT` env var is not set
   - Uses `StdioServerTransport` from MCP SDK
   - No authentication required

2. **HTTP mode**: For remote Claude Chat usage
   - Triggered when `PORT` env var is set
   - Uses `StreamableHTTPServerTransport` from MCP SDK
   - Requires authentication (API key or OAuth 2.0)
   - Implements full OAuth 2.0 Authorization Code flow with PKCE (RFC 7636, 8414, 9728)

### Capability Levels

The server implements a 4-level permission system that controls which tools are available:

- **Level 1 (Monitor)**: Read-only operations (container status, logs, stats, service health)
- **Level 2 (Operate)**: Level 1 + start/stop/restart containers and services
- **Level 3 (Configure)**: Level 2 + read compose files, inspect containers, list volumes/networks/datasets
- **Level 4 (Manage)**: Level 3 + write configs, create/remove containers, exec commands, create snapshots

The capability level is set via `CAPABILITY_LEVEL` env var (1-4) and enforced in `src/index.ts` at tool execution time.

### Tool System

All tools are defined in `src/tools/index.ts` with the following structure:

```typescript
interface ToolDefinition {
  name: string;           // Tool identifier
  description: string;    // User-facing description
  level: number;         // Required capability level (1-4)
  inputSchema: object;   // JSON Schema for arguments
  handler: Function;     // Async function that executes the tool
}
```

Tools are organized by category in separate files:
- `src/tools/docker.ts` - Docker container management (uses dockerode library)
- `src/tools/system.ts` - Host system monitoring
- `src/tools/opnsense.ts` - OPNsense firewall integration (REST API)
- `src/tools/truenas.ts` - TrueNAS storage management (REST API)
- `src/tools/proxmox.ts` - Proxmox virtualization management (REST API)

Each category module must export an `init*()` function called during server startup to initialize connections.

### Configuration

Configuration is loaded from environment variables in `src/config.ts`:

- Required: `CAPABILITY_LEVEL` (1-4)
- For HTTP mode: `PORT` + (`API_KEY` OR (`OAUTH_CLIENT_ID` + `OAUTH_CLIENT_SECRET`))
- Optional: OPNsense, TrueNAS, and Proxmox credentials

The `validateConfig()` function enforces authentication requirements for HTTP mode.

### OAuth 2.0 Implementation

Located in `src/oauth.ts`, implements:

- **Authorization Code flow** with PKCE (for Claude Chat MCP integration)
- **Client Credentials flow** (for backward compatibility/testing)
- In-memory token and authorization code storage with automatic expiration cleanup
- Token expiration: 1 hour
- Authorization code expiration: 10 minutes
- Protected Resource Metadata endpoint (RFC 9728) for MCP spec compliance

HTTP endpoints:
- `/.well-known/oauth-protected-resource` - Protected resource metadata (MCP spec)
- `/.well-known/oauth-authorization-server` - Authorization server metadata (RFC 8414)
- `/oauth/register` - Dynamic client registration (RFC 7591)
- `/authorize` - Authorization endpoint (auto-approves for personal homelab)
- `/oauth/token` - Token endpoint (supports both grant types)
- `/mcp` or `/` - MCP protocol endpoint (requires Bearer token)
- `/health` - Health check (no auth required)

### Docker Integration

The server connects to the Docker socket (`/var/run/docker.sock`) using the dockerode library. For Dockge stack management, it reads/writes compose files from the `DOCKGE_STACKS_PATH` directory (`/opt/stacks`).

**Important**: Level 4 (Manage) capability requires write access to stacks directory. Change the volume mount from `:ro` to `:rw` in `docker-compose.yml`.

### External API Integration

OPNsense, TrueNAS, and Proxmox all use HTTPS APIs with self-signed certificates:

- **OPNsense**: Basic auth with API key/secret, `rejectUnauthorized: false`
- **TrueNAS**: Bearer token auth (`Authorization: Bearer <key>`), `rejectUnauthorized: false`
- **Proxmox**: API token auth (`Authorization: PVEAPIToken=<tokenid>=<secret>`), `rejectUnauthorized: false`
  - Token ID format: `user@realm!tokenid` (e.g., `root@pam!mytoken`)
  - API base path: `/api2/json`
  - Supports both QEMU VMs and LXC containers
  - Responses are wrapped in `{ data: ... }` structure

API clients are initialized once during startup and reused for all requests.

## Adding New Tools

1. Add the tool handler function to the appropriate `src/tools/*.ts` file
2. Add the tool definition to the `ALL_TOOLS` array in `src/tools/index.ts`
3. Set the appropriate capability level (1-4)
4. Define a clear JSON schema for the `inputSchema`
5. The handler receives `(args: any, config: Config)` and returns `Promise<any>`

Example:
```typescript
{
  name: 'docker_my_tool',
  description: 'Clear description of what this does',
  level: 2,  // Operate level
  inputSchema: {
    type: 'object',
    properties: {
      container: { type: 'string', description: 'Container name or ID' },
    },
    required: ['container'],
  },
  handler: async (args) => docker.myToolFunction(args.container),
}
```

## Deployment

The server is deployed as a Docker container with access to:
- Docker socket at `/var/run/docker.sock` (read-only by default)
- Dockge stacks directory at `/opt/stacks` (read-only by default, needs `:rw` for Level 4)

For production deployment:
1. Generate secure credentials: `openssl rand -hex 32`
2. Configure `.env` file from `.env.example`
3. Set up reverse proxy (Traefik/nginx) for HTTPS termination
4. Point DNS to your server
5. Configure Claude Chat with the OAuth credentials

## Testing

```bash
# Health check
curl https://mcp.handley.io/health

# Get OAuth token (client credentials)
curl -X POST https://mcp.handley.io/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"

# Call MCP endpoint
curl https://mcp.handley.io/mcp \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Important Notes

- The server uses ES modules (type: "module" in package.json), so all imports must include `.js` extensions
- TypeScript compiles to `dist/` directory with target ES2022 and NodeNext module resolution
- All external API calls (OPNsense, TrueNAS) disable SSL verification due to self-signed certificates
- Tool execution errors are caught and returned as MCP error responses with `isError: true`
- The server logs all requests and tool executions to stderr for debugging
- Session management in HTTP mode: each request can create a new MCP server instance or reuse an existing transport via `Mcp-Session-Id` header
