import { Config } from './types.js';

export function loadConfig(): Config {
  return {
    capabilityLevel: parseInt(process.env.CAPABILITY_LEVEL || '1', 10),
    apiKey: process.env.API_KEY || '',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : null,

    dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    dockgeStacksPath: process.env.DOCKGE_STACKS_PATH || '/opt/stacks',

    opnsenseHost: process.env.OPNSENSE_HOST || null,
    opnsenseApiKey: process.env.OPNSENSE_API_KEY || null,
    opnsenseApiSecret: process.env.OPNSENSE_API_SECRET || null,

    truenasHost: process.env.TRUENAS_HOST || null,
    truenasApiKey: process.env.TRUENAS_API_KEY || null,
  };
}

export function validateConfig(config: Config): void {
  if (config.capabilityLevel < 1 || config.capabilityLevel > 4) {
    throw new Error('CAPABILITY_LEVEL must be between 1 and 4');
  }

  // API key is required for HTTP mode
  if (config.port && !config.apiKey) {
    throw new Error('API_KEY is required when PORT is set (HTTP mode)');
  }
}
