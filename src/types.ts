export interface Config {
  capabilityLevel: number;
  apiKey: string;
  port: number | null;
  serverDomain: string;

  // OAuth 2.0
  oauthClientId: string | null;
  oauthClientSecret: string | null;

  // Docker
  dockerSocket: string;
  dockgeStacksPath: string;

  // OPNsense
  opnsenseHost: string | null;
  opnsenseApiKey: string | null;
  opnsenseApiSecret: string | null;

  // TrueNAS
  truenasHost: string | null;
  truenasApiKey: string | null;

  // Proxmox
  proxmoxHost: string | null;
  proxmoxTokenId: string | null;
  proxmoxTokenSecret: string | null;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'restarting' | 'created' | 'dead';
  created: string;
  ports: string[];
}

export interface ContainerStats {
  container: string;
  cpu_percent: number;
  memory_usage_mb: number;
  memory_limit_mb: number;
  memory_percent: number;
  network_rx_mb: number;
  network_tx_mb: number;
}

export interface SystemInfo {
  hostname: string;
  uptime_hours: number;
  cpu_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  memory_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  disk_percent: number;
}

export interface OPNsenseStatus {
  version: string;
  uptime: string;
  cpu_percent: number;
  memory_percent: number;
  gateway_status: string;
  services: Array<{
    name: string;
    status: 'running' | 'stopped';
  }>;
}

export interface TrueNASStatus {
  version: string;
  uptime: string;
  pools: Array<{
    name: string;
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    used_percent: number;
  }>;
}

export interface TrueNASAlert {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  datetime: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface DockerNetwork {
  name: string;
  driver: string;
  scope: string;
}

export interface TrueNASDataset {
  name: string;
  pool: string;
  used: string;
  available: string;
  mountpoint: string;
}

export interface TrueNASDatasetInfo extends TrueNASDataset {
  compression: string;
  snapshots: number;
}

export interface ProxmoxStatus {
  version: string;
  nodes: Array<{
    node: string;
    status: 'online' | 'offline';
    cpu_percent: number;
    memory_percent: number;
    uptime: string;
  }>;
}

export interface ProxmoxVM {
  vmid: number;
  name: string;
  node: string;
  type: 'qemu' | 'lxc';
  status: 'running' | 'stopped' | 'paused';
  cpu_percent?: number;
  memory_percent?: number;
  uptime?: string;
}

export interface ProxmoxVMConfig {
  vmid: number;
  name: string;
  node: string;
  type: 'qemu' | 'lxc';
  cores?: number;
  memory?: number;
  disk?: string;
  config: Record<string, any>;
}

export interface ProxmoxStorage {
  storage: string;
  type: string;
  content: string;
  active: boolean;
  used_gb: number;
  total_gb: number;
  used_percent: number;
}

export interface OperationResult {
  success: boolean;
  message: string;
}

export interface ExecResult {
  container: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
}
