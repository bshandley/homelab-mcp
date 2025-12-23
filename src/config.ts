import { Config } from './types.js';

export function loadConfig(): Config {
  return {
    capabilityLevel: parseInt(process.env.CAPABILITY_LEVEL || '1', 10),
    apiKey: process.env.API_KEY || '',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : null,
    serverDomain: process.env.SERVER_DOMAIN || 'mcp.example.com',

    // OAuth 2.0
    oauthClientId: process.env.OAUTH_CLIENT_ID || null,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || null,

    dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    dockgeStacksPath: process.env.DOCKGE_STACKS_PATH || '/opt/stacks',

    opnsenseHost: process.env.OPNSENSE_HOST || null,
    opnsenseApiKey: process.env.OPNSENSE_API_KEY || null,
    opnsenseApiSecret: process.env.OPNSENSE_API_SECRET || null,

    truenasHost: process.env.TRUENAS_HOST || null,
    truenasApiKey: process.env.TRUENAS_API_KEY || null,

    proxmoxHost: process.env.PROXMOX_HOST || null,
    proxmoxTokenId: process.env.PROXMOX_TOKEN_ID || null,
    proxmoxTokenSecret: process.env.PROXMOX_TOKEN_SECRET || null,
  };
}

export function validateConfig(config: Config): void {
  if (config.capabilityLevel < 1 || config.capabilityLevel > 4) {
    throw new Error('CAPABILITY_LEVEL must be between 1 and 4');
  }

  // For HTTP mode, need either API_KEY or OAuth credentials
  if (config.port) {
    const hasApiKey = !!config.apiKey;
    const hasOAuth = !!(config.oauthClientId && config.oauthClientSecret);

    if (!hasApiKey && !hasOAuth) {
      throw new Error('HTTP mode requires either API_KEY or OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET');
    }
  }
}
