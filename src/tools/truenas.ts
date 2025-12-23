import https from 'https';
import { Config, TrueNASStatus, TrueNASAlert, TrueNASDataset, TrueNASDatasetInfo, OperationResult } from '../types.js';

let config: Config;

export function initTrueNAS(cfg: Config): void {
  config = cfg;
}

async function truenasRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  if (!config.truenasHost || !config.truenasApiKey) {
    throw new Error('TrueNAS is not configured');
  }

  const url = `https://${config.truenasHost}/api/v2.0${endpoint}`;

  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${config.truenasApiKey}`,
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
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`TrueNAS API error: ${res.statusCode} - ${data}`));
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

export async function getTrueNASStatus(): Promise<TrueNASStatus> {
  try {
    // Get system info
    const systemInfo = await truenasRequest('/system/info');

    // Get pools
    const pools = await truenasRequest('/pool');

    const poolsFormatted = pools.map((pool: any) => {
      const usedBytes = pool.allocated || 0;
      const totalBytes = (pool.allocated || 0) + (pool.free || 0);
      const usedPercent = totalBytes > 0 ? parseFloat(((usedBytes / totalBytes) * 100).toFixed(2)) : 0;

      return {
        name: pool.name,
        status: pool.status as 'ONLINE' | 'DEGRADED' | 'OFFLINE',
        used_percent: usedPercent,
      };
    });

    return {
      version: systemInfo.version || 'unknown',
      uptime: systemInfo.uptime_seconds ? `${Math.floor(systemInfo.uptime_seconds / 3600)}h` : 'unknown',
      pools: poolsFormatted,
    };
  } catch (error) {
    throw new Error(`Failed to get TrueNAS status: ${(error as Error).message}`);
  }
}

export async function getTrueNASAlerts(): Promise<{ alerts: TrueNASAlert[] }> {
  try {
    const alerts = await truenasRequest('/alert/list');

    const alertsFormatted = alerts.map((alert: any) => ({
      level: (alert.level || 'INFO').toUpperCase() as 'INFO' | 'WARNING' | 'CRITICAL',
      message: alert.formatted || alert.text || 'No message',
      datetime: alert.datetime || new Date().toISOString(),
    }));

    return { alerts: alertsFormatted };
  } catch (error) {
    throw new Error(`Failed to get TrueNAS alerts: ${(error as Error).message}`);
  }
}

// Level 3 - Configure

export async function listTrueNASDatasets(): Promise<{ datasets: TrueNASDataset[] }> {
  try {
    const datasets = await truenasRequest('/pool/dataset');

    const datasetsFormatted = datasets.map((ds: any) => {
      const poolName = ds.name?.split('/')[0] || 'unknown';

      return {
        name: ds.name,
        pool: poolName,
        used: formatBytes(ds.used?.parsed || 0),
        available: formatBytes(ds.available?.parsed || 0),
        mountpoint: ds.mountpoint || 'none',
      };
    });

    return { datasets: datasetsFormatted };
  } catch (error) {
    throw new Error(`Failed to list TrueNAS datasets: ${(error as Error).message}`);
  }
}

export async function getTrueNASDatasetInfo(dataset: string): Promise<TrueNASDatasetInfo> {
  try {
    const ds = await truenasRequest(`/pool/dataset/id/${encodeURIComponent(dataset)}`);

    const poolName = ds.name?.split('/')[0] || 'unknown';

    // Get snapshots count
    const snapshots = await truenasRequest(`/zfs/snapshot?dataset=${encodeURIComponent(dataset)}`);

    return {
      name: ds.name,
      pool: poolName,
      used: formatBytes(ds.used?.parsed || 0),
      available: formatBytes(ds.available?.parsed || 0),
      compression: ds.compression?.value || 'off',
      mountpoint: ds.mountpoint || 'none',
      snapshots: snapshots.length || 0,
    };
  } catch (error) {
    throw new Error(`Failed to get dataset info: ${(error as Error).message}`);
  }
}

// Level 4 - Manage

export async function createTrueNASSnapshot(
  dataset: string,
  name?: string
): Promise<OperationResult & { snapshot: string }> {
  try {
    const snapshotName = name || `snapshot-${Date.now()}`;
    const fullSnapshotName = `${dataset}@${snapshotName}`;

    await truenasRequest('/zfs/snapshot', 'POST', {
      dataset,
      name: snapshotName,
    });

    return {
      success: true,
      snapshot: fullSnapshotName,
      message: `Snapshot ${fullSnapshotName} created successfully`,
    };
  } catch (error) {
    return {
      success: false,
      snapshot: `${dataset}@${name || 'unknown'}`,
      message: `Failed to create snapshot: ${(error as Error).message}`,
    };
  }
}

// Helper functions

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
