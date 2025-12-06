import { Config } from './types.js';
import { randomBytes, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';

// Simple in-memory token store
const activeTokens = new Map<string, { expiresAt: number }>();

// Token expiration time in seconds (1 hour)
const TOKEN_EXPIRATION = 3600;

// Clean up expired tokens periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of activeTokens.entries()) {
    if (data.expiresAt < now) {
      activeTokens.delete(token);
    }
  }
}, 60000);

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface TokenError {
  error: string;
  error_description: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    return false;
  }

  return cryptoTimingSafeEqual(bufA, bufB);
}

export function validateClientCredentials(
  clientId: string,
  clientSecret: string,
  config: Config
): boolean {
  if (!config.oauthClientId || !config.oauthClientSecret) {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  try {
    const idMatch = timingSafeEqual(clientId, config.oauthClientId);
    const secretMatch = timingSafeEqual(clientSecret, config.oauthClientSecret);
    return idMatch && secretMatch;
  } catch {
    return false;
  }
}

export function issueToken(): TokenResponse {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (TOKEN_EXPIRATION * 1000);

  activeTokens.set(token, { expiresAt });

  console.error(`[OAuth] Issued new token, expires in ${TOKEN_EXPIRATION}s`);

  return {
    access_token: token,
    token_type: 'Bearer',
    expires_in: TOKEN_EXPIRATION,
  };
}

export function validateAccessToken(token: string, config: Config): boolean {
  // First check if it's a static API key (backward compatibility)
  if (config.apiKey && token === config.apiKey) {
    return true;
  }

  // Then check OAuth tokens
  const tokenData = activeTokens.get(token);

  if (!tokenData) {
    return false;
  }

  if (tokenData.expiresAt < Date.now()) {
    activeTokens.delete(token);
    return false;
  }

  return true;
}

export function parseBasicAuth(authHeader: string): { clientId: string; clientSecret: string } | null {
  if (!authHeader.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64 = authHeader.substring(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');

    if (colonIndex === -1) {
      return null;
    }

    const clientId = decoded.substring(0, colonIndex);
    const clientSecret = decoded.substring(colonIndex + 1);

    if (!clientId || !clientSecret) {
      return null;
    }

    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

export async function parseRequestBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

export function parseFormUrlEncoded(body: string): Record<string, string> {
  const params: Record<string, string> = {};

  for (const pair of body.split('&')) {
    const [key, value] = pair.split('=');
    if (key && value !== undefined) {
      params[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }

  return params;
}
