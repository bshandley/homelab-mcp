# Homelab MCP Server

A remote MCP (Model Context Protocol) server for managing homelab infrastructure. Provides Claude with tools to monitor and manage Docker containers, OPNsense firewall, and TrueNAS storage.

## Features

- **4 Capability Levels**: From read-only monitoring to full management control
- **Docker Management**: List, monitor, control containers and Dockge stacks
- **OPNsense Integration**: Monitor firewall status and restart services
- **TrueNAS Integration**: Check pool health, manage datasets, create snapshots
- **System Monitoring**: CPU, memory, disk usage on the host

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
PORT=3000

# OPNsense (optional)
OPNSENSE_HOST=10.0.0.1
OPNSENSE_API_KEY=your-key
OPNSENSE_API_SECRET=your-secret

# TrueNAS (optional)
TRUENAS_HOST=10.0.0.105
TRUENAS_API_KEY=your-key
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
        "TRUENAS_API_KEY": "your-key"
      }
    }
  }
}
```

For remote deployment via HTTPS, see the deployment section in the plan document.

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

### Level 2 - Operate
- `docker_restart_container` - Restart a container
- `docker_start_container` - Start a container
- `docker_stop_container` - Stop a container
- `opnsense_service_restart` - Restart OPNsense service

### Level 3 - Configure
- `docker_read_compose` - Read docker-compose.yml
- `docker_list_volumes` - List Docker volumes
- `docker_list_networks` - List Docker networks
- `docker_inspect_container` - Inspect container details
- `truenas_list_datasets` - List ZFS datasets
- `truenas_dataset_info` - Get dataset details

### Level 4 - Manage
- `docker_write_compose` - Write docker-compose.yml
- `docker_compose_up` - Deploy a stack
- `docker_compose_down` - Remove a stack
- `docker_exec` - Execute command in container
- `truenas_create_snapshot` - Create ZFS snapshot

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
