import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { OAuthTokens } from './OAuthManager.js';

/**
 * Imports credentials from a locally installed Codex CLI (~/.codex/auth.json).
 * The CLI stores ChatGPT-subscription OAuth tokens there after `codex login`;
 * they use the same public client_id our OAuth flow uses, so access/refresh
 * tokens are interchangeable. account_id is required as the
 * ChatGPT-Account-Id header on chatgpt.com/backend-api/codex calls.
 */

export interface CodexCliAuth {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  /** JWT exp claim (ms epoch) when decodable, else undefined. */
  expiresAt?: number;
}

export function codexAuthPath(): string {
  return path.join(os.homedir(), '.codex', 'auth.json');
}

function jwtExp(token: string): number | undefined {
  try {
    const part = token.split('.')[1];
    if (!part) return undefined;
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Read ~/.codex/auth.json. Returns null when absent or malformed. */
export function readCodexCliAuth(authPath = codexAuthPath()): CodexCliAuth | null {
  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    const data = JSON.parse(raw) as {
      tokens?: {
        access_token?: string;
        refresh_token?: string;
        account_id?: string;
        id_token?: string;
      };
    };
    const tokens = data.tokens;
    const accessToken = tokens?.access_token;
    if (!accessToken) return null;

    // account_id may live at top level of tokens or inside the id_token claims.
    let accountId = tokens?.account_id;
    if (!accountId && tokens?.id_token) {
      try {
        const part = tokens.id_token.split('.')[1];
        const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
        accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
      } catch { /* ignore */ }
    }

    return {
      accessToken,
      refreshToken: tokens?.refresh_token,
      accountId,
      expiresAt: jwtExp(accessToken),
    };
  } catch {
    return null;
  }
}

export function codexAuthToOAuthTokens(auth: CodexCliAuth): OAuthTokens {
  return {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    expiresAt: auth.expiresAt,
    tokenType: 'Bearer',
    accountId: auth.accountId,
  };
}
