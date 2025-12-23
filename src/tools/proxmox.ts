import https from 'https';
import { Config, ProxmoxStatus, ProxmoxVM, ProxmoxVMConfig, ProxmoxStorage, OperationResult } from '../types.js';

let config: Config;

export function initProxmox(cfg: Config): void {
  config = cfg;
}

async function proxmoxRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  if (!config.proxmoxHost || !config.proxmoxTokenId || !config.proxmoxTokenSecret) {
    throw new Error('Proxmox is not configured');
  }

  const url = `https://${config.proxmoxHost}:8006/api2/json${endpoint}`;

  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `PVEAPIToken=${config.proxmoxTokenId}=${config.proxmoxTokenSecret}`,
        'Content-Type': 'application/json',
      },
      // Allow self-signed certificates
      rejectUnauthorized: false,
    };

    const req = https.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            // Proxmox API wraps responses in { data: ... }
            resolve(parsed.data !== undefined ? parsed.data : parsed);
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`Proxmox API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// Level 1 - Monitor

export async function getProxmoxStatus(): Promise<ProxmoxStatus> {
  try {
    // Get version
    const version = await proxmoxRequest('/version');

    // Get nodes
    const nodes = await proxmoxRequest('/nodes');

    const nodesFormatted = nodes.map((node: any) => ({
      node: node.node,
      status: node.status === 'online' ? 'online' as const : 'offline' as const,
      cpu_percent: parseFloat(((node.cpu || 0) * 100).toFixed(2)),
      memory_percent: parseFloat(((node.mem || 0) / (node.maxmem || 1) * 100).toFixed(2)),
      uptime: formatUptime(node.uptime || 0),
    }));

    return {
      version: version.version || 'unknown',
      nodes: nodesFormatted,
    };
  } catch (error) {
    throw new Error(`Failed to get Proxmox status: ${(error as Error).message}`);
  }
}

export async function listProxmoxVMs(): Promise<{ vms: ProxmoxVM[] }> {
  try {
    // Get all nodes first
    const nodes = await proxmoxRequest('/nodes');

    const allVMs: ProxmoxVM[] = [];

    // For each node, get both QEMU VMs and LXC containers
    for (const node of nodes) {
      const nodeName = node.node;

      // Get QEMU VMs
      try {
        const qemuVMs = await proxmoxRequest(`/nodes/${nodeName}/qemu`);
        for (const vm of qemuVMs) {
          allVMs.push({
            vmid: vm.vmid,
            name: vm.name || `VM ${vm.vmid}`,
            node: nodeName,
            type: 'qemu',
            status: vm.status === 'running' ? 'running' : vm.status === 'paused' ? 'paused' : 'stopped',
            cpu_percent: vm.cpu ? parseFloat((vm.cpu * 100).toFixed(2)) : undefined,
            memory_percent: vm.maxmem ? parseFloat(((vm.mem || 0) / vm.maxmem * 100).toFixed(2)) : undefined,
            uptime: vm.uptime ? formatUptime(vm.uptime) : undefined,
          });
        }
      } catch (e) {
        console.error(`[Proxmox] Could not fetch QEMU VMs for node ${nodeName}:`, (e as Error).message);
      }

      // Get LXC containers
      try {
        const lxcContainers = await proxmoxRequest(`/nodes/${nodeName}/lxc`);
        for (const ct of lxcContainers) {
          allVMs.push({
            vmid: ct.vmid,
            name: ct.name || `CT ${ct.vmid}`,
            node: nodeName,
            type: 'lxc',
            status: ct.status === 'running' ? 'running' : ct.status === 'paused' ? 'paused' : 'stopped',
            cpu_percent: ct.cpu ? parseFloat((ct.cpu * 100).toFixed(2)) : undefined,
            memory_percent: ct.maxmem ? parseFloat(((ct.mem || 0) / ct.maxmem * 100).toFixed(2)) : undefined,
            uptime: ct.uptime ? formatUptime(ct.uptime) : undefined,
          });
        }
      } catch (e) {
        console.error(`[Proxmox] Could not fetch LXC containers for node ${nodeName}:`, (e as Error).message);
      }
    }

    return { vms: allVMs };
  } catch (error) {
    throw new Error(`Failed to list Proxmox VMs: ${(error as Error).message}`);
  }
}

export async function getProxmoxVMStatus(node: string, vmid: number, type: 'qemu' | 'lxc'): Promise<ProxmoxVM> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    const status = await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/status/current`);

    return {
      vmid,
      name: status.name || `${type.toUpperCase()} ${vmid}`,
      node,
      type,
      status: status.status === 'running' ? 'running' : status.status === 'paused' ? 'paused' : 'stopped',
      cpu_percent: status.cpu ? parseFloat((status.cpu * 100).toFixed(2)) : undefined,
      memory_percent: status.maxmem ? parseFloat(((status.mem || 0) / status.maxmem * 100).toFixed(2)) : undefined,
      uptime: status.uptime ? formatUptime(status.uptime) : undefined,
    };
  } catch (error) {
    throw new Error(`Failed to get VM status: ${(error as Error).message}`);
  }
}

// Level 2 - Operate

export async function startProxmoxVM(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc'
): Promise<OperationResult & { vmid: number }> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/status/start`, 'POST', {});

    return {
      success: true,
      vmid,
      message: `${type.toUpperCase()} ${vmid} started successfully`,
    };
  } catch (error) {
    return {
      success: false,
      vmid,
      message: `Failed to start VM: ${(error as Error).message}`,
    };
  }
}

export async function stopProxmoxVM(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc'
): Promise<OperationResult & { vmid: number }> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/status/stop`, 'POST', {});

    return {
      success: true,
      vmid,
      message: `${type.toUpperCase()} ${vmid} stopped successfully`,
    };
  } catch (error) {
    return {
      success: false,
      vmid,
      message: `Failed to stop VM: ${(error as Error).message}`,
    };
  }
}

export async function shutdownProxmoxVM(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc'
): Promise<OperationResult & { vmid: number }> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/status/shutdown`, 'POST', {});

    return {
      success: true,
      vmid,
      message: `${type.toUpperCase()} ${vmid} shutdown initiated`,
    };
  } catch (error) {
    return {
      success: false,
      vmid,
      message: `Failed to shutdown VM: ${(error as Error).message}`,
    };
  }
}

export async function rebootProxmoxVM(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc'
): Promise<OperationResult & { vmid: number }> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/status/reboot`, 'POST', {});

    return {
      success: true,
      vmid,
      message: `${type.toUpperCase()} ${vmid} rebooted successfully`,
    };
  } catch (error) {
    return {
      success: false,
      vmid,
      message: `Failed to reboot VM: ${(error as Error).message}`,
    };
  }
}

// Level 3 - Configure

export async function getProxmoxVMConfig(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc'
): Promise<ProxmoxVMConfig> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    const config = await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/config`);

    return {
      vmid,
      name: config.name || config.hostname || `${type.toUpperCase()} ${vmid}`,
      node,
      type,
      cores: config.cores || config.cpus,
      memory: config.memory,
      disk: config.bootdisk || config.rootfs,
      config,
    };
  } catch (error) {
    throw new Error(`Failed to get VM config: ${(error as Error).message}`);
  }
}

export async function listProxmoxStorage(node?: string): Promise<{ storage: ProxmoxStorage[] }> {
  try {
    let storageList: any[] = [];

    if (node) {
      // Get storage for specific node
      storageList = await proxmoxRequest(`/nodes/${node}/storage`);
      storageList = storageList.map((s: any) => ({ ...s, node }));
    } else {
      // Get all nodes and their storage
      const nodes = await proxmoxRequest('/nodes');
      for (const n of nodes) {
        const nodeStorage = await proxmoxRequest(`/nodes/${n.node}/storage`);
        storageList.push(...nodeStorage.map((s: any) => ({ ...s, node: n.node })));
      }
    }

    const storageFormatted = storageList.map((storage: any) => {
      const totalBytes = storage.total || 0;
      const usedBytes = storage.used || 0;
      const usedPercent = totalBytes > 0 ? parseFloat((usedBytes / totalBytes * 100).toFixed(2)) : 0;

      return {
        storage: storage.storage,
        type: storage.type || 'unknown',
        content: storage.content || 'unknown',
        active: storage.active === 1,
        used_gb: parseFloat((usedBytes / (1024 ** 3)).toFixed(2)),
        total_gb: parseFloat((totalBytes / (1024 ** 3)).toFixed(2)),
        used_percent: usedPercent,
      };
    });

    return { storage: storageFormatted };
  } catch (error) {
    throw new Error(`Failed to list Proxmox storage: ${(error as Error).message}`);
  }
}

export async function listProxmoxNodes(): Promise<{ nodes: Array<{ node: string; status: string; uptime: string }> }> {
  try {
    const nodes = await proxmoxRequest('/nodes');

    const nodesFormatted = nodes.map((node: any) => ({
      node: node.node,
      status: node.status || 'unknown',
      uptime: formatUptime(node.uptime || 0),
    }));

    return { nodes: nodesFormatted };
  } catch (error) {
    throw new Error(`Failed to list Proxmox nodes: ${(error as Error).message}`);
  }
}

// Level 4 - Manage

export async function createProxmoxVMSnapshot(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc',
  snapname?: string
): Promise<OperationResult & { snapshot: string }> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    const snapshotName = snapname || `snapshot-${Date.now()}`;

    await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}/snapshot`, 'POST', {
      snapname: snapshotName,
    });

    return {
      success: true,
      snapshot: snapshotName,
      message: `Snapshot ${snapshotName} created successfully for ${type.toUpperCase()} ${vmid}`,
    };
  } catch (error) {
    return {
      success: false,
      snapshot: snapname || 'unknown',
      message: `Failed to create snapshot: ${(error as Error).message}`,
    };
  }
}

export async function deleteProxmoxVM(
  node: string,
  vmid: number,
  type: 'qemu' | 'lxc'
): Promise<OperationResult & { vmid: number }> {
  try {
    const vmType = type === 'lxc' ? 'lxc' : 'qemu';
    await proxmoxRequest(`/nodes/${node}/${vmType}/${vmid}`, 'DELETE');

    return {
      success: true,
      vmid,
      message: `${type.toUpperCase()} ${vmid} deleted successfully`,
    };
  } catch (error) {
    return {
      success: false,
      vmid,
      message: `Failed to delete VM: ${(error as Error).message}`,
    };
  }
}

// Helper functions

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}
