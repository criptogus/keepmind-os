import { shell } from 'electron';
import { AgentManager } from '../agent/AgentManager.js';
import * as crypto from 'crypto';
import * as http from 'http';

export interface OAuthConfig {
  provider: 'openai' | 'anthropic';
  clientId: string;
  clientSecret?: string; // only for confidential clients
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  betaHeader?: string; // e.g. Anthropic requires 'oauth-2025-04-20' on API calls
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  idToken?: string;
  scope?: string;
  /** ChatGPT account id — required as ChatGPT-Account-Id header on Codex backend calls. */
  accountId?: string;
}

// Real endpoints verified against provider docs:
// - OpenAI: https://developers.openai.com/siwc/website (Sign in with ChatGPT, partner-gated beta)
//   Discovery: https://auth.openai.com/.well-known/openid-configuration
// - Anthropic: Claude Code OAuth flow (Max subscription / Console modes)
//   See https://platform.claude.com/docs and Claude Code constants/oauth.ts
const OPENAI_DISCOVERY = 'https://auth.openai.com/.well-known/openid-configuration';

const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Claude Code public client

export class OAuthManager {
  private agentManager: AgentManager;
  /** Called whenever fresh tokens are issued/refreshed — used to persist them. */
  private onTokens?: (provider: 'openai' | 'anthropic', tokens: OAuthTokens) => void;
  /** Injectable for tests; defaults to opening the system browser. */
  private openExternal: (url: string) => Promise<void>;
  private authUrls = new Map<'openai' | 'anthropic', string>();
  /** In-flight authenticate() per provider — a second call re-opens the
   *  browser with the same URL instead of failing on the bound port. */
  private inflight = new Map<'openai' | 'anthropic', Promise<OAuthTokens>>();
  private pendingRequests: Map<string, {
    resolve: (tokens: OAuthTokens) => void;
    reject: (error: Error) => void;
  }> = new Map();

  private configs: Record<'openai' | 'anthropic', OAuthConfig> = {
    openai: {
      provider: 'openai',
      // Codex CLI public client — "Sign in with ChatGPT" (subscription OAuth).
      // Tokens authenticate against chatgpt.com/backend-api/codex, NOT api.openai.com.
      clientId: process.env.OPENAI_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann',
      clientSecret: process.env.OPENAI_CLIENT_SECRET || undefined,
      redirectUri: process.env.OPENAI_OAUTH_REDIRECT_URI || 'http://localhost:1455/auth/callback',
      authUrl: 'https://auth.openai.com/oauth/authorize',
      tokenUrl: 'https://auth.openai.com/oauth/token',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      extraAuthParams: {
        // Required by the Codex client registration — identifies the client
        // family to auth.openai.com (same value the Codex CLI sends).
        originator: 'codex_cli_rs',
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
      },
    },
    anthropic: {
      provider: 'anthropic',
      // Claude Code's public client ID — works for Max/Pro subscription OAuth.
      // For Console (API key creation) mode use platform.claude.com authorize URL
      // and your own registered client_id if available.
      clientId: process.env.ANTHROPIC_CLIENT_ID || ANTHROPIC_CLIENT_ID,
      clientSecret: process.env.ANTHROPIC_CLIENT_SECRET || undefined,
      redirectUri: process.env.ANTHROPIC_OAUTH_REDIRECT_URI || 'http://localhost:54545/callback',
      // 'max' mode (subscription) uses claude.com/cai/oauth/authorize;
      // 'console' mode uses platform.claude.com/oauth/authorize
      authUrl: process.env.ANTHROPIC_OAUTH_MODE === 'console'
        ? 'https://platform.claude.com/oauth/authorize'
        : 'https://claude.com/cai/oauth/authorize',
      tokenUrl: 'https://platform.claude.com/v1/oauth/token',
      scopes: [
        'org:create_api_key',
        'user:profile',
        'user:inference',
        'user:sessions:claude_code',
        'user:mcp_servers',
        'user:file_upload',
      ],
      extraAuthParams: {
        // Claude Code sends code=true challenge flag for its flow
        code: 'true',
      },
      betaHeader: 'oauth-2025-04-20',
    },
  };

  constructor(
    agentManager: AgentManager,
    onTokens?: (provider: 'openai' | 'anthropic', tokens: OAuthTokens) => void,
    openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
  ) {
    this.agentManager = agentManager;
    this.onTokens = onTokens;
    this.openExternal = openExternal;
  }

  /** Fetch OpenAI's live OIDC discovery doc to confirm endpoints haven't drifted. */
  static async getOpenAiDiscovery(): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(OPENAI_DISCOVERY);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  async authenticate(provider: 'openai' | 'anthropic'): Promise<OAuthTokens> {
    const existing = this.inflight.get(provider);
    if (existing) {
      // A flow is already waiting for the browser callback — just bring the
      // authorize page up again and share the same result.
      const url = this.authUrls.get(provider);
      if (url) {
        this.openExternal(url).catch(() => { /* best effort re-open */ });
      }
      return existing;
    }

    const promise = this.startFlow(provider);
    this.inflight.set(provider, promise);
    promise.then(
      () => this.inflight.delete(provider),
      () => this.inflight.delete(provider),
    );
    return promise;
  }

  private async startFlow(provider: 'openai' | 'anthropic'): Promise<OAuthTokens> {
    const config = this.configs[provider];
    if (!config.clientId) {
      throw new Error(`${provider} OAuth client_id not configured (set ${provider.toUpperCase()}_CLIENT_ID)`);
    }

    const state = crypto.randomBytes(16).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(state, { resolve, reject });

      const authUrl = new URL(config.authUrl);
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', config.redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', config.scopes.join(' '));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      for (const [k, v] of Object.entries(config.extraAuthParams || {})) {
        authUrl.searchParams.set(k, v);
      }
      this.authUrls.set(provider, authUrl.toString());

      // The authorize page must run in the system browser — providers require
      // passkey/MFA/WebAuthn which embedded windows can't complete. The
      // redirect_uri points at a localhost callback server we run here.
      const redirect = new URL(config.redirectUri);
      const port = Number(redirect.port);
      const cbPath = redirect.pathname || '/';
      const host = redirect.hostname || 'localhost';

      const server = http.createServer((req, res) => {
        try {
          const u = new URL(req.url || '/', `http://${host}:${port}`);
          if (u.pathname !== cbPath) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:4rem">' +
            '<h2>Authentication complete</h2><p>You can close this tab and return to KeepMind OS.</p>' +
            '</body></html>'
          );
          server.close();
          this.handleCallback(`http://${host}:${port}${req.url}`, provider, codeVerifier);
        } catch {
          // malformed request — ignore
        }
      });

      const failFlow = (err: Error) => {
        const pending = this.pendingRequests.get(state);
        if (pending) {
          pending.reject(err);
          this.pendingRequests.delete(state);
        }
        server.close();
      };

      server.once('error', (err) => {
        failFlow(new Error(
          `OAuth callback port ${port} is unavailable (${err.message}). ` +
          'Another OAuth flow may already be running.'
        ));
      });

      server.listen(port, '127.0.0.1', () => {
        this.openExternal(authUrl.toString()).catch((e) => {
          failFlow(new Error(`Could not open system browser: ${e instanceof Error ? e.message : String(e)}`));
        });
      });

      // Give up if the user never completes the flow in the browser.
      const timer = setTimeout(() => {
        failFlow(new Error('OAuth timed out — no callback received from the browser'));
      }, 5 * 60 * 1000);
      timer.unref?.();
    });
  }

  /** Last authorize URL issued per provider (for tests/debugging). */
  getAuthUrl(provider: 'openai' | 'anthropic'): string | null {
    return this.authUrls.get(provider) ?? null;
  }

  private async handleCallback(url: string, provider: 'openai' | 'anthropic', codeVerifier: string) {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');
    const errorDescription = urlObj.searchParams.get('error_description');

    const fail = (err: Error) => {
      const pending = this.pendingRequests.get(state || '');
      if (pending) {
        pending.reject(err);
        this.pendingRequests.delete(state || '');
      }
    };

    if (error) {
      fail(new Error(`OAuth error: ${error}${errorDescription ? ` — ${errorDescription}` : ''}`));
      return;
    }
    if (!code || !state) {
      fail(new Error('Missing code or state in OAuth callback'));
      return;
    }

    const pending = this.pendingRequests.get(state);
    if (!pending) {
      console.error('No pending OAuth request for state:', state);
      return;
    }

    try {
      const tokens = await this.exchangeCodeForTokens(provider, code, codeVerifier, state);
      pending.resolve(tokens);
      this.pendingRequests.delete(state);
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.pendingRequests.delete(state);
    }
  }

  private async exchangeCodeForTokens(
    provider: 'openai' | 'anthropic',
    code: string,
    codeVerifier: string,
    state: string
  ): Promise<OAuthTokens> {
    const config = this.configs[provider];

    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: codeVerifier,
      state,
    };
    if (config.clientSecret) {
      body.client_secret = config.clientSecret;
    }

    // Anthropic's token endpoint expects JSON, not form-encoded
    const isJson = provider === 'anthropic';
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        ...(config.betaHeader ? { 'anthropic-beta': config.betaHeader } : {}),
      },
      body: isJson ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '');
      throw new Error(`Token exchange failed (${tokenResponse.status}): ${text.slice(0, 300)}`);
    }

    const tokenData = await tokenResponse.json();

    const tokens: OAuthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
      tokenType: tokenData.token_type || 'Bearer',
      idToken: tokenData.id_token,
      scope: tokenData.scope,
    };

    this.agentManager.setOAuthToken(provider, tokens.accessToken);
    if (config.betaHeader) {
      this.agentManager.setOAuthBetaHeader(provider, config.betaHeader);
    }
    this.onTokens?.(provider, tokens);

    return tokens;
  }

  async refreshToken(provider: 'openai' | 'anthropic', refreshToken: string): Promise<OAuthTokens> {
    const config = this.configs[provider];

    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      scope: config.scopes.join(' '),
    };
    if (config.clientSecret) {
      body.client_secret = config.clientSecret;
    }

    const isJson = provider === 'anthropic';
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
        ...(config.betaHeader ? { 'anthropic-beta': config.betaHeader } : {}),
      },
      body: isJson ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '');
      throw new Error(`Token refresh failed (${tokenResponse.status}): ${text.slice(0, 300)}`);
    }

    const tokenData = await tokenResponse.json();

    const tokens: OAuthTokens = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
      tokenType: tokenData.token_type || 'Bearer',
      idToken: tokenData.id_token,
      scope: tokenData.scope,
    };

    this.agentManager.setOAuthToken(provider, tokens.accessToken);
    this.onTokens?.(provider, tokens);

    return tokens;
  }

  isAuthenticated(provider: 'openai' | 'anthropic'): boolean {
    return this.agentManager.hasOAuthToken(provider);
  }

  isConfigured(provider: 'openai' | 'anthropic'): boolean {
    return this.configs[provider].clientId.length > 0;
  }

  getToken(provider: 'openai' | 'anthropic'): string | null {
    return this.agentManager.getOAuthToken(provider);
  }

  getBetaHeader(provider: 'openai' | 'anthropic'): string | null {
    return this.agentManager.getOAuthBetaHeader(provider);
  }

  /** The beta header this provider's OAuth flow requires on API calls. */
  configuredBetaHeader(provider: 'openai' | 'anthropic'): string | null {
    return this.configs[provider].betaHeader || null;
  }

  clearToken(provider: 'openai' | 'anthropic'): void {
    this.agentManager.clearOAuthToken(provider);
  }

  async logout(provider: 'openai' | 'anthropic'): Promise<void> {
    this.clearToken(provider);
  }
}
