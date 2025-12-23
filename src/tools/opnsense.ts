import https from 'https';
import { Config, OPNsenseStatus, OperationResult } from '../types.js';

let config: Config;

export function initOPNsense(cfg: Config): void {
  config = cfg;
}

async function opnsenseRequest(
  endpoint: string,
  method: string = 'GET',
  body?: any
): Promise<any> {
  if (!config.opnsenseHost || !config.opnsenseApiKey || !config.opnsenseApiSecret) {
    throw new Error('OPNsense is not configured');
  }

  const auth = Buffer.from(`${config.opnsenseApiKey}:${config.opnsenseApiSecret}`).toString('base64');
  const url = `https://${config.opnsenseHost}/api${endpoint}`;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Authorization': `Basic ${auth}`,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      method,
      headers,
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
          reject(new Error(`OPNsense API error: ${res.statusCode} - ${data}`));
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

/**
 * Parse memory string like "1594M" or "204K" to bytes
 */
function parseMemoryValue(str: string): number {
  const match = str.match(/^([\d.]+)([KMGT]?)/i);
  if (!match) return 0;
  
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  
  switch (unit) {
    case 'K': return value * 1024;
    case 'M': return value * 1024 * 1024;
    case 'G': return value * 1024 * 1024 * 1024;
    case 'T': return value * 1024 * 1024 * 1024 * 1024;
    default: return value;
  }
}

/**
 * Parse CPU line like "CPU:  7.5% user,  0.0% nice,  4.4% system,  0.0% interrupt, 88.1% idle"
 * Returns CPU usage percentage (100 - idle)
 */
function parseCpuLine(line: string): number {
  const idleMatch = line.match(/([\d.]+)%\s*idle/i);
  if (idleMatch) {
    const idle = parseFloat(idleMatch[1]);
    return Math.round((100 - idle) * 10) / 10; // Round to 1 decimal
  }
  return 0;
}

/**
 * Parse memory line like "Mem: 1594M Active, 4429M Inact, 5555M Wired, 204K Buf, 4043M Free"
 * Returns memory usage percentage
 */
function parseMemoryLine(line: string): number {
  // Extract all memory values
  const activeMatch = line.match(/([\d.]+[KMGT]?)\s*Active/i);
  const inactMatch = line.match(/([\d.]+[KMGT]?)\s*Inact/i);
  const wiredMatch = line.match(/([\d.]+[KMGT]?)\s*Wired/i);
  const bufMatch = line.match(/([\d.]+[KMGT]?)\s*Buf/i);
  const freeMatch = line.match(/([\d.]+[KMGT]?)\s*Free/i);

  const active = activeMatch ? parseMemoryValue(activeMatch[1]) : 0;
  const inact = inactMatch ? parseMemoryValue(inactMatch[1]) : 0;
  const wired = wiredMatch ? parseMemoryValue(wiredMatch[1]) : 0;
  const buf = bufMatch ? parseMemoryValue(bufMatch[1]) : 0;
  const free = freeMatch ? parseMemoryValue(freeMatch[1]) : 0;

  const total = active + inact + wired + buf + free;
  if (total === 0) return 0;

  // "Used" = Active + Wired (memory that can't be immediately reclaimed)
  // Inactive can be reclaimed if needed, so we don't count it as "used"
  const used = active + wired;
  
  return Math.round((used / total) * 1000) / 10; // Round to 1 decimal
}

// Level 1 - Monitor

export async function getOPNsenseStatus(): Promise<OPNsenseStatus> {
  try {
    // Get firmware status - this has the version info
    let version = 'unknown';
    try {
      const firmwareStatus = await opnsenseRequest('/core/firmware/status');
      version = firmwareStatus.product?.product_version || 
                firmwareStatus.product?.CORE_VERSION || 
                'unknown';
      if (firmwareStatus.product?.product_nickname) {
        version += ` (${firmwareStatus.product.product_nickname})`;
      }
    } catch (e) {
      console.error('[OPNsense] Could not fetch firmware status:', (e as Error).message);
    }

    // Get uptime from system time endpoint
    let uptime = 'unknown';
    try {
      const systemTime = await opnsenseRequest('/diagnostics/system/systemTime');
      uptime = systemTime.uptime || 'unknown';
    } catch (e) {
      console.error('[OPNsense] Could not fetch systemTime:', (e as Error).message);
    }

    // Get CPU and memory from activity endpoint
    let cpuPercent = 0;
    let memoryPercent = 0;
    try {
      const activity = await opnsenseRequest('/diagnostics/activity/getActivity');
      if (activity.headers && Array.isArray(activity.headers)) {
        for (const header of activity.headers) {
          if (header.startsWith('CPU:')) {
            cpuPercent = parseCpuLine(header);
          } else if (header.startsWith('Mem:')) {
            memoryPercent = parseMemoryLine(header);
          }
        }
      }
    } catch (e) {
      console.error('[OPNsense] Could not fetch activity:', (e as Error).message);
    }

    // Get service status
    const serviceSearchBody = {
      current: 1,
      rowCount: 100,
      sort: {},
      searchPhrase: '',
    };
    const services = await opnsenseRequest('/core/service/search', 'POST', serviceSearchBody);

    // Get gateway status
    let gatewayStatus = 'unknown';
    try {
      const gateways = await opnsenseRequest('/routes/gateway/status');
      if (gateways.items) {
        const allUp = Object.values(gateways.items).every(
          (gw: any) => gw.status === 'none' || gw.status === 'online'
        );
        gatewayStatus = allUp ? 'online' : 'degraded';
      } else if (gateways.status) {
        gatewayStatus = gateways.status;
      }
    } catch (e) {
      console.error('[OPNsense] Could not fetch gateway status:', (e as Error).message);
    }

    // Parse service list
    const serviceList = services.rows?.map((svc: any) => ({
      name: svc.name || svc.id,
      status: svc.running === 1 || svc.running === '1' ? 'running' as const : 'stopped' as const,
    })) || [];

    return {
      version,
      uptime,
      cpu_percent: cpuPercent,
      memory_percent: memoryPercent,
      gateway_status: gatewayStatus,
      services: serviceList,
    };
  } catch (error) {
    throw new Error(`Failed to get OPNsense status: ${(error as Error).message}`);
  }
}

// Level 2 - Operate

export async function restartOPNsenseService(service: string): Promise<OperationResult & { service: string }> {
  try {
    await opnsenseRequest(`/core/service/restart/${service}`, 'POST', {});

    return {
      success: true,
      service,
      message: `Service ${service} restarted successfully`,
    };
  } catch (error) {
    return {
      success: false,
      service,
      message: `Failed to restart service: ${(error as Error).message}`,
    };
  }
}
