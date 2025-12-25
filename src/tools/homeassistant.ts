import https from 'https';
import http from 'http';
import { Config, HomeAssistantStatus, HomeAssistantEntity, HomeAssistantService, OperationResult } from '../types.js';

let config: Config;

export function initHomeAssistant(cfg: Config): void {
  config = cfg;
}

async function homeAssistantRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  if (!config.homeAssistantHost || !config.homeAssistantToken) {
    throw new Error('Home Assistant is not configured');
  }

  const protocol = config.homeAssistantUseHttps ? 'https' : 'http';
  const url = `${protocol}://${config.homeAssistantHost}:${config.homeAssistantPort}/api${endpoint}`;
  const httpModule = config.homeAssistantUseHttps ? https : http;

  return new Promise((resolve, reject) => {
    const options: any = {
      method,
      headers: {
        'Authorization': `Bearer ${config.homeAssistantToken}`,
        'Content-Type': 'application/json',
      },
    };

    // Allow self-signed certificates for HTTPS
    if (config.homeAssistantUseHttps) {
      options.rejectUnauthorized = false;
    }

    const req = httpModule.request(url, options, (res) => {
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
          reject(new Error(`Home Assistant API error: ${res.statusCode} - ${data}`));
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

export async function getHomeAssistantStatus(): Promise<HomeAssistantStatus> {
  try {
    // Get configuration
    const configData = await homeAssistantRequest('/config');

    // Get all entity states
    const states = await homeAssistantRequest('/states');

    // Count automations (entities that start with 'automation.')
    const automations = states.filter((entity: any) =>
      entity.entity_id.startsWith('automation.')
    );

    // Get unique domains
    const domains: string[] = [...new Set(states.map((entity: any) =>
      entity.entity_id.split('.')[0]
    ))].sort() as string[];

    return {
      version: configData.version || 'unknown',
      location: configData.location_name || 'Home',
      entities_count: states.length,
      automations_count: automations.length,
      domains,
    };
  } catch (error) {
    throw new Error(`Failed to get Home Assistant status: ${(error as Error).message}`);
  }
}

export async function listHomeAssistantEntities(domain?: string): Promise<{ entities: HomeAssistantEntity[] }> {
  try {
    const states = await homeAssistantRequest('/states');

    let filteredStates = states;
    if (domain) {
      filteredStates = states.filter((entity: any) =>
        entity.entity_id.startsWith(`${domain}.`)
      );
    }

    const entities = filteredStates.map((entity: any) => ({
      entity_id: entity.entity_id,
      state: entity.state,
      friendly_name: entity.attributes?.friendly_name || entity.entity_id,
      last_updated: entity.last_updated,
      attributes: entity.attributes || {},
    }));

    return { entities };
  } catch (error) {
    throw new Error(`Failed to list Home Assistant entities: ${(error as Error).message}`);
  }
}

export async function getHomeAssistantEntity(entity_id: string): Promise<HomeAssistantEntity> {
  try {
    const entity = await homeAssistantRequest(`/states/${encodeURIComponent(entity_id)}`);

    return {
      entity_id: entity.entity_id,
      state: entity.state,
      friendly_name: entity.attributes?.friendly_name || entity.entity_id,
      last_updated: entity.last_updated,
      attributes: entity.attributes || {},
    };
  } catch (error) {
    throw new Error(`Failed to get entity ${entity_id}: ${(error as Error).message}`);
  }
}

export async function listHomeAssistantServices(): Promise<{ services: HomeAssistantService[] }> {
  try {
    const servicesData = await homeAssistantRequest('/services');

    const services = Object.entries(servicesData).map(([domain, domainServices]: [string, any]) => ({
      domain,
      services: Object.keys(domainServices),
    }));

    return { services };
  } catch (error) {
    throw new Error(`Failed to list Home Assistant services: ${(error as Error).message}`);
  }
}

// Level 2 - Operate

export async function callHomeAssistantService(
  domain: string,
  service: string,
  entity_id?: string,
  service_data?: Record<string, any>
): Promise<OperationResult> {
  try {
    const body: any = {};

    if (entity_id) {
      body.entity_id = entity_id;
    }

    if (service_data) {
      Object.assign(body, service_data);
    }

    await homeAssistantRequest(`/services/${domain}/${service}`, 'POST', body);

    return {
      success: true,
      message: `Successfully called ${domain}.${service}${entity_id ? ` on ${entity_id}` : ''}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to call ${domain}.${service}: ${(error as Error).message}`,
    };
  }
}

export async function turnOnEntity(entity_id: string): Promise<OperationResult> {
  try {
    // Determine the domain from entity_id
    const domain = entity_id.split('.')[0];

    await homeAssistantRequest(`/services/${domain}/turn_on`, 'POST', { entity_id });

    return {
      success: true,
      message: `Successfully turned on ${entity_id}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to turn on ${entity_id}: ${(error as Error).message}`,
    };
  }
}

export async function turnOffEntity(entity_id: string): Promise<OperationResult> {
  try {
    // Determine the domain from entity_id
    const domain = entity_id.split('.')[0];

    await homeAssistantRequest(`/services/${domain}/turn_off`, 'POST', { entity_id });

    return {
      success: true,
      message: `Successfully turned off ${entity_id}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to turn off ${entity_id}: ${(error as Error).message}`,
    };
  }
}

export async function toggleEntity(entity_id: string): Promise<OperationResult> {
  try {
    // Determine the domain from entity_id
    const domain = entity_id.split('.')[0];

    await homeAssistantRequest(`/services/${domain}/toggle`, 'POST', { entity_id });

    return {
      success: true,
      message: `Successfully toggled ${entity_id}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to toggle ${entity_id}: ${(error as Error).message}`,
    };
  }
}

// Level 3 - Configure

export async function getHomeAssistantConfig(): Promise<Record<string, any>> {
  try {
    const configData = await homeAssistantRequest('/config');
    return configData;
  } catch (error) {
    throw new Error(`Failed to get Home Assistant config: ${(error as Error).message}`);
  }
}

export async function getHomeAssistantErrorLog(): Promise<{ log: string }> {
  try {
    const log = await homeAssistantRequest('/error_log');
    return { log };
  } catch (error) {
    throw new Error(`Failed to get Home Assistant error log: ${(error as Error).message}`);
  }
}

// Level 4 - Manage

export async function triggerAutomation(automation_id: string): Promise<OperationResult> {
  try {
    await homeAssistantRequest('/services/automation/trigger', 'POST', { entity_id: automation_id });

    return {
      success: true,
      message: `Successfully triggered automation ${automation_id}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to trigger automation ${automation_id}: ${(error as Error).message}`,
    };
  }
}
