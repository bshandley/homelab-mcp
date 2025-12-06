import https from 'https';
import { Config, OPNsenseStatus, OperationResult } from '../types.js';

let config: Config;

export function initOPNsense(cfg: Config): void {
  config = cfg;
}

async function opnsenseRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  if (!config.opnsense.host || !config.opnsense.apiKey || !config.opnsense.apiSecret) {
    throw new Error('OPNsense is not configured');
  }

  const auth = Buffer.from(`${config.opnsense.apiKey}:${config.opnsense.apiSecret}`).toString('base64');

  const url = `https://${config.opnsense.host}/api${endpoint}`;

  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Authorization': `Basic ${auth}`,
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

// Level 1 - Monitor

export async function getOPNsenseStatus(): Promise<OPNsenseStatus> {
  try {
    // Get system status
    const systemStatus = await opnsenseRequest('/core/system/status');

    // Get service status
    const services = await opnsenseRequest('/core/service/search');

    // Parse and format the response
    const serviceList = services.rows?.map((svc: any) => ({
      name: svc.name || svc.id,
      status: svc.running === '1' ? 'running' as const : 'stopped' as const,
    })) || [];

    return {
      version: systemStatus.product_version || 'unknown',
      uptime: systemStatus.uptime || 'unknown',
      cpu_percent: parseFloat(systemStatus.cpu?.used || '0'),
      memory_percent: parseFloat(systemStatus.memory?.used || '0'),
      gateway_status: systemStatus.gateway?.status || 'unknown',
      services: serviceList,
    };
  } catch (error) {
    throw new Error(`Failed to get OPNsense status: ${(error as Error).message}`);
  }
}

// Level 2 - Operate

export async function restartOPNsenseService(service: string): Promise<OperationResult & { service: string }> {
  try {
    await opnsenseRequest(`/core/service/restart/${service}`, 'POST');

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
