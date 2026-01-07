import { Config } from '../types.js';
import * as docker from './docker.js';
import * as system from './system.js';
import * as opnsense from './opnsense.js';
import * as truenas from './truenas.js';
import * as proxmox from './proxmox.js';
import * as homeAssistant from './homeassistant.js';

export interface ToolDefinition {
  name: string;
  description: string;
  level: number;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  handler: (args: any, config: Config) => Promise<any>;
}

// Define all tools with their capability levels
const ALL_TOOLS: ToolDefinition[] = [
  // Level 1 - Monitor
  {
    name: 'docker_list_containers',
    description: 'List all Docker containers with their status',
    level: 1,
    inputSchema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Include stopped containers (default: true)',
        },
      },
    },
    handler: async (args) => docker.listContainers(args.all ?? true),
  },
  {
    name: 'docker_container_logs',
    description: 'Get recent logs from a container',
    level: 1,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
        lines: {
          type: 'number',
          description: 'Number of lines to return (default: 50, max: 500)',
        },
        since: {
          type: 'string',
          description: 'Only logs since timestamp, e.g., "1h", "30m"',
        },
        filter: {
          type: 'string',
          description: 'Regex pattern to filter log lines (e.g., "error|warn|fail")',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.getContainerLogs(args.container, args.lines, args.since, args.filter),
  },
  {
    name: 'docker_container_stats',
    description: 'Get CPU/memory/network stats for a container',
    level: 1,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.getContainerStats(args.container),
  },
  {
    name: 'system_info',
    description: 'Get host system information (disk, memory, CPU usage)',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => system.getSystemInfo(),
  },
  {
    name: 'opnsense_status',
    description: 'Get OPNsense firewall/gateway status',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => opnsense.getOPNsenseStatus(),
  },
  {
    name: 'truenas_status',
    description: 'Get TrueNAS pool health and system status',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => truenas.getTrueNASStatus(),
  },
  {
    name: 'truenas_alerts',
    description: 'Get active TrueNAS alerts',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => truenas.getTrueNASAlerts(),
  },
  {
    name: 'proxmox_status',
    description: 'Get Proxmox cluster status and node information',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => proxmox.getProxmoxStatus(),
  },
  {
    name: 'proxmox_list_vms',
    description: 'List all Proxmox VMs and containers across all nodes',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => proxmox.listProxmoxVMs(),
  },
  {
    name: 'proxmox_vm_status',
    description: 'Get detailed status of a specific Proxmox VM or container',
    level: 1,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.getProxmoxVMStatus(args.node, args.vmid, args.type),
  },
  {
    name: 'home_assistant_status',
    description: 'Get Home Assistant version, entity count, and available domains',
    level: 1,
    inputSchema: {
      type: 'object',
    },
    handler: async () => homeAssistant.getHomeAssistantStatus(),
  },
  {
    name: 'home_assistant_list_entities',
    description: 'List all Home Assistant entities (lights, switches, sensors, etc.)',
    level: 1,
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Optional: Filter by domain (e.g., "light", "switch", "sensor")',
        },
      },
    },
    handler: async (args) => homeAssistant.listHomeAssistantEntities(args.domain),
  },
  {
    name: 'home_assistant_get_entity',
    description: 'Get detailed state and attributes of a specific Home Assistant entity',
    level: 1,
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'string',
          description: 'Entity ID (e.g., "light.living_room", "switch.bedroom")',
        },
      },
      required: ['entity_id'],
    },
    handler: async (args) => homeAssistant.getHomeAssistantEntity(args.entity_id),
  },
  // Level 2 - Operate
  {
    name: 'docker_restart_container',
    description: 'Restart a container',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.restartContainer(args.container),
  },
  {
    name: 'docker_start_container',
    description: 'Start a stopped container',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.startContainer(args.container),
  },
  {
    name: 'docker_stop_container',
    description: 'Stop a running container',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
        timeout: {
          type: 'number',
          description: 'Seconds to wait before force kill (default: 10)',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.stopContainer(args.container, args.timeout),
  },
  {
    name: 'opnsense_service_restart',
    description: 'Restart an OPNsense service',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'Service name',
        },
      },
      required: ['service'],
    },
    handler: async (args) => opnsense.restartOPNsenseService(args.service),
  },
  {
    name: 'proxmox_start_vm',
    description: 'Start a Proxmox VM or container',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.startProxmoxVM(args.node, args.vmid, args.type),
  },
  {
    name: 'proxmox_stop_vm',
    description: 'Stop a Proxmox VM or container (forceful)',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.stopProxmoxVM(args.node, args.vmid, args.type),
  },
  {
    name: 'proxmox_shutdown_vm',
    description: 'Gracefully shutdown a Proxmox VM or container',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.shutdownProxmoxVM(args.node, args.vmid, args.type),
  },
  {
    name: 'proxmox_reboot_vm',
    description: 'Reboot a Proxmox VM or container',
    level: 2,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.rebootProxmoxVM(args.node, args.vmid, args.type),
  },
  // Level 3 - Configure
  {
    name: 'docker_read_compose',
    description: 'Read the docker-compose.yml for a Dockge stack',
    level: 3,
    inputSchema: {
      type: 'object',
      properties: {
        stack: {
          type: 'string',
          description: 'Stack name as shown in Dockge',
        },
      },
      required: ['stack'],
    },
    handler: async (args, config) => docker.readComposeFile(args.stack, config),
  },
  {
    name: 'docker_read_env_file',
    description: 'Read the .env file for a Dockge stack',
    level: 3,
    inputSchema: {
      type: 'object',
      properties: {
        stack: {
          type: 'string',
          description: 'Stack name as shown in Dockge',
        },
      },
      required: ['stack'],
    },
    handler: async (args, config) => docker.readEnvFile(args.stack, config),
  },
  {
    name: 'docker_list_volumes',
    description: 'List Docker volumes',
    level: 3,
    inputSchema: {
      type: 'object',
    },
    handler: async () => docker.listVolumes(),
  },
  {
    name: 'docker_list_networks',
    description: 'List Docker networks',
    level: 3,
    inputSchema: {
      type: 'object',
    },
    handler: async () => docker.listNetworks(),
  },
  {
    name: 'docker_inspect_container',
    description: 'Get full container configuration details',
    level: 3,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.inspectContainer(args.container),
  },
  {
    name: 'truenas_list_datasets',
    description: 'List ZFS datasets',
    level: 3,
    inputSchema: {
      type: 'object',
    },
    handler: async () => truenas.listTrueNASDatasets(),
  },
  {
    name: 'truenas_dataset_info',
    description: 'Get detailed info about a specific dataset',
    level: 3,
    inputSchema: {
      type: 'object',
      properties: {
        dataset: {
          type: 'string',
          description: 'Dataset name',
        },
      },
      required: ['dataset'],
    },
    handler: async (args) => truenas.getTrueNASDatasetInfo(args.dataset),
  },
  {
    name: 'proxmox_vm_config',
    description: 'Get full configuration details for a Proxmox VM or container',
    level: 3,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.getProxmoxVMConfig(args.node, args.vmid, args.type),
  },
  {
    name: 'proxmox_list_storage',
    description: 'List Proxmox storage across all nodes or a specific node',
    level: 3,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name (optional, lists all if not provided)',
        },
      },
    },
    handler: async (args) => proxmox.listProxmoxStorage(args.node),
  },
  {
    name: 'proxmox_list_nodes',
    description: 'List all Proxmox nodes in the cluster',
    level: 3,
    inputSchema: {
      type: 'object',
    },
    handler: async () => proxmox.listProxmoxNodes(),
  },
  {
    name: 'home_assistant_get_config',
    description: 'Get full Home Assistant configuration details',
    level: 3,
    inputSchema: {
      type: 'object',
    },
    handler: async () => homeAssistant.getHomeAssistantConfig(),
  },
  {
    name: 'home_assistant_error_log',
    description: 'Get Home Assistant error log',
    level: 3,
    inputSchema: {
      type: 'object',
    },
    handler: async () => homeAssistant.getHomeAssistantErrorLog(),
  },

  // Level 4 - Manage
  {
    name: 'docker_write_compose',
    description: 'Write or update a docker-compose.yml for a Dockge stack',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        stack: {
          type: 'string',
          description: 'Stack name',
        },
        compose: {
          type: 'string',
          description: 'Full YAML content',
        },
      },
      required: ['stack', 'compose'],
    },
    handler: async (args, config) => docker.writeComposeFile(args.stack, args.compose, config),
  },
  {
    name: 'docker_compose_up',
    description: 'Deploy/restart a Dockge stack',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        stack: {
          type: 'string',
          description: 'Stack name',
        },
      },
      required: ['stack'],
    },
    handler: async (args, config) => docker.composeUp(args.stack, config),
  },
  {
    name: 'docker_compose_down',
    description: 'Tear down a Dockge stack',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        stack: {
          type: 'string',
          description: 'Stack name',
        },
        remove_volumes: {
          type: 'boolean',
          description: 'Also remove volumes (default: false)',
        },
      },
      required: ['stack'],
    },
    handler: async (args, config) => docker.composeDown(args.stack, args.remove_volumes ?? false, config),
  },
  {
    name: 'docker_exec',
    description: 'Execute a command in a running container',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        container: {
          type: 'string',
          description: 'Container name or ID',
        },
        command: {
          type: 'string',
          description: 'Command to run',
        },
        timeout: {
          type: 'number',
          description: 'Max seconds to wait (default: 30, max: 60)',
        },
      },
      required: ['container', 'command'],
    },
    handler: async (args) => {
      const timeout = Math.min(args.timeout ?? 30, 60);
      return docker.execInContainer(args.container, args.command, timeout);
    },
  },
  {
    name: 'truenas_create_snapshot',
    description: 'Create a ZFS snapshot',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        dataset: {
          type: 'string',
          description: 'Dataset name',
        },
        name: {
          type: 'string',
          description: 'Snapshot name (optional, auto-generated if not provided)',
        },
      },
      required: ['dataset'],
    },
    handler: async (args) => truenas.createTrueNASSnapshot(args.dataset, args.name),
  },
  {
    name: 'proxmox_create_snapshot',
    description: 'Create a snapshot of a Proxmox VM or container',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
        snapname: {
          type: 'string',
          description: 'Snapshot name (optional, auto-generated if not provided)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.createProxmoxVMSnapshot(args.node, args.vmid, args.type, args.snapname),
  },
  {
    name: 'proxmox_delete_vm',
    description: 'Delete a Proxmox VM or container',
    level: 4,
    inputSchema: {
      type: 'object',
      properties: {
        node: {
          type: 'string',
          description: 'Node name',
        },
        vmid: {
          type: 'number',
          description: 'VM/Container ID',
        },
        type: {
          type: 'string',
          enum: ['qemu', 'lxc'],
          description: 'VM type: qemu (virtual machine) or lxc (container)',
        },
      },
      required: ['node', 'vmid', 'type'],
    },
    handler: async (args) => proxmox.deleteProxmoxVM(args.node, args.vmid, args.type),
  },
];

export function getToolsForLevel(level: number): ToolDefinition[] {
  return ALL_TOOLS.filter(tool => tool.level <= level);
}

export function getTool(name: string): ToolDefinition | undefined {
  return ALL_TOOLS.find(tool => tool.name === name);
}

export function initializeTools(config: Config): void {
  docker.initDocker(config);
  opnsense.initOPNsense(config);
  truenas.initTrueNAS(config);
  proxmox.initProxmox(config);
  homeAssistant.initHomeAssistant(config);
}
