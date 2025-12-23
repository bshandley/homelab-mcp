import { Config } from './types.js';
import { randomBytes, timingSafeEqual as cryptoTimingSafeEqual, createHash } from 'crypto';

// Simple in-memory token store
const activeTokens = new Map<string, { expiresAt: number }>();

// Authorization code store (code -> { codeChallenge, clientId, redirectUri, expiresAt })
const authorizationCodes = new Map<string, {
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  redirectUri: string;
  expiresAt: number;
}>();

// Token expiration time in seconds (1 hour)
const TOKEN_EXPIRATION = 3600;

// Auth code expiration (10 minutes)
const AUTH_CODE_EXPIRATION = 600;

// Clean up expired tokens and codes periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of activeTokens.entries()) {
    if (data.expiresAt < now) {
      activeTokens.delete(token);
    }
  }
  for (const [code, data] of authorizationCodes.entries()) {
    if (data.expiresAt < now) {
      authorizationCodes.delete(code);
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

export function validateClientId(clientId: string, config: Config): boolean {
  if (!config.oauthClientId) {
    return false;
  }
  try {
    return timingSafeEqual(clientId, config.oauthClientId);
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

// Authorization Code flow functions

export function createAuthorizationCode(
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string
): string {
  const code = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (AUTH_CODE_EXPIRATION * 1000);

  authorizationCodes.set(code, {
    codeChallenge,
    codeChallengeMethod,
    clientId,
    redirectUri,
    expiresAt,
  });

  console.error(`[OAuth] Created authorization code for client: ${clientId}`);
  return code;
}

export function validateAuthorizationCode(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string
): { valid: boolean; error?: string } {
  const codeData = authorizationCodes.get(code);

  if (!codeData) {
    return { valid: false, error: 'Invalid authorization code' };
  }

  // Code can only be used once
  authorizationCodes.delete(code);

  if (codeData.expiresAt < Date.now()) {
    return { valid: false, error: 'Authorization code expired' };
  }

  if (codeData.clientId !== clientId) {
    return { valid: false, error: 'Client ID mismatch' };
  }

  if (codeData.redirectUri !== redirectUri) {
    return { valid: false, error: 'Redirect URI mismatch' };
  }

  // Validate PKCE
  if (!validatePKCE(codeVerifier, codeData.codeChallenge, codeData.codeChallengeMethod)) {
    return { valid: false, error: 'Invalid code verifier' };
  }

  return { valid: true };
}

function validatePKCE(
  codeVerifier: string,
  codeChallenge: string,
  codeChallengeMethod: string
): boolean {
  if (codeChallengeMethod === 'S256') {
    // SHA256 hash of verifier, base64url encoded
    const hash = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return hash === codeChallenge;
  } else if (codeChallengeMethod === 'plain') {
    return codeVerifier === codeChallenge;
  }
  return false;
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
      params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
    }
  }

  return params;
}
