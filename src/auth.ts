import { Config } from './types.js';

export function validateApiKey(authHeader: string | undefined, config: Config): boolean {
  if (!authHeader) {
    console.warn('[Auth] Missing Authorization header');
    return false;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    console.warn('[Auth] Invalid Authorization header format');
    return false;
  }

  const providedKey = match[1];
  const isValid = providedKey === config.apiKey;

  if (!isValid) {
    console.warn('[Auth] Invalid API key provided');
  }

  return isValid;
}
