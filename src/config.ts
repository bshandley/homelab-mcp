import { Config } from './types.js';

export function loadConfig(): Config {
  const capabilityLevel = parseInt(process.env.CAPABILITY_LEVEL || '1', 10);

  if (capabilityLevel < 1 || capabilityLevel > 4) {
    throw new Error('CAPABILITY_LEVEL must be between 1 and 4');
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY is required');
  }

  const port = parseInt(process.env.PORT || '3000', 10);

  return {
    capabilityLevel,
    apiKey,
    port,
    opnsense: {
      host: process.env.OPNSENSE_HOST || '',
      apiKey: process.env.OPNSENSE_API_KEY || '',
      apiSecret: process.env.OPNSENSE_API_SECRET || '',
    },
    truenas: {
      host: process.env.TRUENAS_HOST || '',
      apiKey: process.env.TRUENAS_API_KEY || '',
    },
    docker: {
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    },
    dockge: {
      stacksPath: process.env.DOCKGE_STACKS_PATH || '/opt/stacks',
    },
  };
}

export function validateConfig(config: Config): void {
  console.log(`[Config] Capability Level: ${config.capabilityLevel}`);
  console.log(`[Config] Port: ${config.port}`);

  if (config.opnsense.host && config.opnsense.apiKey && config.opnsense.apiSecret) {
    console.log(`[Config] OPNsense integration enabled (${config.opnsense.host})`);
  } else {
    console.warn('[Config] OPNsense integration disabled (missing credentials)');
  }

  if (config.truenas.host && config.truenas.apiKey) {
    console.log(`[Config] TrueNAS integration enabled (${config.truenas.host})`);
  } else {
    console.warn('[Config] TrueNAS integration disabled (missing credentials)');
  }

  console.log(`[Config] Docker socket: ${config.docker.socketPath}`);
  console.log(`[Config] Dockge stacks: ${config.dockge.stacksPath}`);
}
