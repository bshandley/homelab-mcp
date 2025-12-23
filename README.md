# Homelab MCP Server

A remote MCP (Model Context Protocol) server for managing homelab infrastructure. Provides Claude with tools to monitor and manage Docker containers, OPNsense firewall, TrueNAS storage, and Proxmox virtualization.

## Features

- **4 Capability Levels**: From read-only monitoring to full management control
- **Docker Management**: List, monitor, control containers and Dockge stacks
- **OPNsense Integration**: Monitor firewall status and restart services
- **TrueNAS Integration**: Check pool health, manage datasets, create snapshots
- **Proxmox Integration**: Monitor and manage VMs/containers, create snapshots
- **System Monitoring**: CPU, memory, disk usage on the host

## ⚠️ DANGER - READ THIS FIRST

**This software grants AI models direct control over your network infrastructure. Use with extreme caution.**

### Critical Risks

- **AI Can Make Mistakes**: Language models can misinterpret instructions, hallucinate requirements, or execute unintended actions. A simple request like "clean up unused containers" could result in critical services being stopped.

- **Destructive Actions Are Possible**: At higher capability levels (3-4), the AI can:
  - Delete virtual machines and containers
  - Modify network configurations
  - Remove critical datasets or snapshots
  - Execute arbitrary commands in production systems
  - Overwrite docker-compose files, potentially causing data loss

- **No Undo Button**: Once the AI executes a destructive action (deletes a VM, removes a dataset, stops a critical service), the damage is immediate and may be irreversible.

- **Network Security Implications**: This server provides API access to your firewall, storage system, and virtualization platform. A compromised API key or misconfigured capability level could allow unauthorized control over your entire homelab.

- **Misunderstandings Happen**: AI models may not fully understand your infrastructure's dependencies. Restarting one service could cascade into network-wide outages.

### Recommendations

1. **Start with Level 1 (Read-Only)**: Always begin with monitoring-only access and only increase capability levels when absolutely necessary.

2. **Test in Development**: If possible, test with non-production infrastructure first to understand how the AI interprets your requests.

3. **Review Before Executing**: At Level 2+, carefully review what actions the AI plans to take before confirming execution.

4. **Keep Backups**: Ensure you have recent backups of all critical systems before granting Level 3+ access.

5. **Rotate Credentials**: Regularly rotate API keys and OAuth credentials. Treat them as highly sensitive.

6. **Monitor Logs**: Watch the container logs to see what actions are being executed in real-time.

7. **Use Network Segmentation**: Consider running this server in a restricted network segment with limited access to critical infrastructure.

**BY USING THIS SOFTWARE, YOU ACKNOWLEDGE THAT YOU UNDERSTAND THESE RISKS AND ACCEPT FULL RESPONSIBILITY FOR ANY ACTIONS TAKEN BY THE AI, INCLUDING DATA LOSS, SERVICE DISRUPTION, OR SECURITY INCIDENTS.**

## Quick Start

### 1. Prerequisites

- Docker and Docker Compose installed on target host (Wharf)
- OPNsense API credentials (optional)
- TrueNAS API key (optional)
- Node.js 20+ (for local development)

### 2. Setup

```bash
# Clone or copy the project to your host
cd homelab-mcp

# Copy example environment file
cp .env.example .env

# Generate a secure API key
openssl rand -hex 32

# Edit .env and add your credentials
nano .env
```

### 3. Configuration

Edit `.env` with your settings:

```env
CAPABILITY_LEVEL=1        # Start with level 1 (read-only)
API_KEY=your-api-key-here # Use the generated key
PORT=3005

# OPNsense (optional)
OPNSENSE_HOST=10.0.0.1
OPNSENSE_API_KEY=your-key
OPNSENSE_API_SECRET=your-secret

# TrueNAS (optional)
TRUENAS_HOST=10.0.0.105
TRUENAS_API_KEY=your-key

# Proxmox (optional)
PROXMOX_HOST=10.0.0.2
PROXMOX_TOKEN_ID=root@pam!mytoken
PROXMOX_TOKEN_SECRET=your-secret
```

### 4. Build and Deploy

```bash
# Build TypeScript
npm install
npm run build

# Build Docker image
docker compose build

# Start the server
docker compose up -d

# Check logs
docker compose logs -f
```

### 5. Configure Claude Desktop

Add to your Claude Desktop MCP settings:

```json
{
  "mcpServers": {
    "homelab": {
      "command": "node",
      "args": ["/path/to/homelab-mcp/dist/index.js"],
      "env": {
        "CAPABILITY_LEVEL": "1",
        "API_KEY": "your-api-key-here",
        "OPNSENSE_HOST": "10.0.0.1",
        "OPNSENSE_API_KEY": "your-key",
        "OPNSENSE_API_SECRET": "your-secret",
        "TRUENAS_HOST": "10.0.0.105",
        "TRUENAS_API_KEY": "your-key",
        "PROXMOX_HOST": "10.0.0.2",
        "PROXMOX_TOKEN_ID": "root@pam!mytoken",
        "PROXMOX_TOKEN_SECRET": "your-secret"
      }
    }
  }
}
```

### Remote Access (Claude Chat)

For accessing the MCP server from Claude Chat (web interface), deploy with HTTP transport:

1. **Set environment variables in `.env`:**
   ```env
   PORT=3000
   API_KEY=your-generated-key
   CAPABILITY_LEVEL=1
   ```

2. **Deploy the container:**
   ```bash
   docker compose up -d
   ```

3. **Configure reverse proxy** (e.g., Traefik, Pangolin, nginx) to route `mcp.example.com` to `http://localhost:3000`

4. **Add DNS record** pointing `mcp.example.com` to your server

5. **In Claude Chat**, add the MCP server:
   - URL: `https://mcp.example.com/mcp`
   - Authentication: Bearer token
   - Token: Your API_KEY value

### OAuth 2.0 Authentication (for Claude Chat)

Claude Chat requires OAuth 2.0 for custom connectors. This server supports the Client Credentials flow.

1. **Generate OAuth credentials:**
   ```bash
   # Generate client ID
   openssl rand -hex 32

   # Generate client secret
   openssl rand -hex 32
   ```

2. **Add to `.env`:**
   ```env
   OAUTH_CLIENT_ID=your-generated-client-id
   OAUTH_CLIENT_SECRET=your-generated-client-secret
   ```

3. **In Claude Chat, add the connector:**
   - Name: `Homelab`
   - Remote MCP server URL: `https://mcp.example.com/mcp`
   - OAuth Client ID: Your generated client ID
   - OAuth Client Secret: Your generated client secret

The server will issue access tokens valid for 1 hour. Claude Chat handles token refresh automatically.

### Endpoints

When running in HTTP mode:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check, returns status and capability level |
| `/oauth/token` | POST | No | OAuth 2.0 token endpoint |
| `/mcp` | POST | Yes | MCP protocol endpoint |
| `/` | POST | Yes | Alias for /mcp |

### Testing

```bash
# Test health endpoint
curl https://mcp.example.com/health

# Get an access token
curl -X POST https://mcp.example.com/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET"

# Use the token
curl https://mcp.example.com/mcp \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Capability Levels

| Level | Name | Capabilities |
|-------|------|-------------|
| 1 | Monitor | Read-only: container status, logs, stats, system info, service health |
| 2 | Operate | Level 1 + start/stop/restart containers and services |
| 3 | Configure | Level 2 + read compose files, configs, volumes, networks |
| 4 | Manage | Level 3 + write configs, create/remove containers, exec commands |

**Recommendation**: Start with Level 1 and increase as needed.

## Available Tools

### Level 1 - Monitor
- `docker_list_containers` - List all containers
- `docker_container_logs` - Get container logs
- `docker_container_stats` - Get container CPU/memory stats
- `system_info` - Get host system info
- `opnsense_status` - Get OPNsense status
- `truenas_status` - Get TrueNAS pool status
- `truenas_alerts` - Get TrueNAS alerts
- `proxmox_status` - Get Proxmox cluster status
- `proxmox_list_vms` - List all VMs and containers
- `proxmox_vm_status` - Get VM/container status

### Level 2 - Operate
- `docker_restart_container` - Restart a container
- `docker_start_container` - Start a container
- `docker_stop_container` - Stop a container
- `opnsense_service_restart` - Restart OPNsense service
- `proxmox_start_vm` - Start a VM/container
- `proxmox_stop_vm` - Stop a VM/container
- `proxmox_shutdown_vm` - Gracefully shutdown a VM/container
- `proxmox_reboot_vm` - Reboot a VM/container

### Level 3 - Configure
- `docker_read_compose` - Read docker-compose.yml
- `docker_list_volumes` - List Docker volumes
- `docker_list_networks` - List Docker networks
- `docker_inspect_container` - Inspect container details
- `truenas_list_datasets` - List ZFS datasets
- `truenas_dataset_info` - Get dataset details
- `proxmox_vm_config` - Get VM/container configuration
- `proxmox_list_storage` - List Proxmox storage
- `proxmox_list_nodes` - List cluster nodes

### Level 4 - Manage
- `docker_write_compose` - Write docker-compose.yml
- `docker_compose_up` - Deploy a stack
- `docker_compose_down` - Remove a stack
- `docker_exec` - Execute command in container
- `truenas_create_snapshot` - Create ZFS snapshot
- `proxmox_create_snapshot` - Create VM/container snapshot
- `proxmox_delete_vm` - Delete a VM/container

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Type check
npx tsc --noEmit
```

## Security Notes

- The API key should be kept secret and rotated periodically
- Start with the lowest capability level you need
- For Level 4, the `/opt/stacks` mount must be `:rw` instead of `:ro`
- The container requires access to the Docker socket for container management
- OPNsense and TrueNAS APIs use self-signed certificates by default

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs homelab-mcp

# Common issues:
# - Missing API_KEY in .env
# - Invalid CAPABILITY_LEVEL (must be 1-4)
# - Docker socket not accessible
```

### Tools failing

```bash
# Test OPNsense API
curl -k -u "key:secret" https://10.0.0.1/api/core/system/status

# Test TrueNAS API
curl -k -H "Authorization: Bearer YOUR_KEY" https://10.0.0.105/api/v2.0/system/info

# Check network connectivity from container
docker exec homelab-mcp ping 10.0.0.1
```

### Permission issues

If you need Level 4 (write access to stacks), update the volume mount:

```yaml
volumes:
  - /opt/stacks:/opt/stacks:rw  # Change from :ro to :rw
```

## License

MIT

## Contributing

Issues and pull requests welcome!
