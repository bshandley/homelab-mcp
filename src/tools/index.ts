import { Config } from '../types.js';
import * as docker from './docker.js';
import * as system from './system.js';
import * as opnsense from './opnsense.js';
import * as truenas from './truenas.js';

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
          description: 'Number of lines to return (default: 100, max: 1000)',
        },
        since: {
          type: 'string',
          description: 'Only logs since timestamp, e.g., "1h", "30m"',
        },
      },
      required: ['container'],
    },
    handler: async (args) => docker.getContainerLogs(args.container, args.lines, args.since),
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
}
