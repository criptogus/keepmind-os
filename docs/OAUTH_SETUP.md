# OAuth Configuration for AI Providers

Zero Agency OS supports two authentication methods for OpenAI and Anthropic:

1. **API keys** — works today, set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
2. **OAuth 2.0 + PKCE** — implemented, but availability depends on the provider (see caveats below)

## Real endpoints (verified)

### OpenAI — "Sign in with ChatGPT"

- Discovery document: `https://auth.openai.com/.well-known/openid-configuration`
- Authorize: `https://auth.openai.com/api/accounts/authorize`
- Token: `https://auth.openai.com/api/accounts/oauth/token`
- Scopes: `openid profile email` (OIDC — returns an `id_token`)
- Client IDs start with `oaiapp_`

**Caveat:** this is a **partner-gated beta** (launch partners include Notion, Vercel, Supabase, GitLab, Airtable, HubSpot). You must request an OAuth client from OpenAI before the flow works. There is no self-serve registration today.

### Anthropic — Claude OAuth (Claude Code flow)

- Authorize (subscription/"max" mode): `https://claude.com/cai/oauth/authorize`
- Authorize (console mode): `https://platform.claude.com/oauth/authorize` — set `ANTHROPIC_OAUTH_MODE=console`
- Token: `https://platform.claude.com/v1/oauth/token` (JSON body, not form-encoded)
- Default client ID (Claude Code public client): `9d1c250a-e61b-44d9-88ed-5944d1962f5e` — override with `ANTHROPIC_CLIENT_ID`
- Scopes: `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`
- API calls with the resulting token require `Authorization: Bearer <token>` (handled via SDK `authToken`) **and** the `anthropic-beta: oauth-2025-04-20` header (handled automatically by `AgentManager`)

**Caveat:** this OAuth flow is designed for Claude Code / claude.ai subscriptions. Using the public client ID in a third-party app works technically (other OSS tools do it), but review Anthropic's terms — the supported path for production apps is a Console API key, or Anthropic's `oauth_anthropic_creds` connector model.

## Environment variables

```bash
# API keys (recommended, works today)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI OAuth — only after OpenAI grants you an oaiapp_ client
# OPENAI_CLIENT_ID=oaiapp_...
# OPENAI_CLIENT_SECRET=...        # confidential clients only
# OPENAI_OAUTH_REDIRECT_URI=http://localhost:1455/auth/callback

# Anthropic OAuth — works with the built-in Claude Code client ID
# ANTHROPIC_CLIENT_ID=9d1c250a-e61b-44d9-88ed-5944d1962f5e
# ANTHROPIC_OAUTH_MODE=max        # or 'console'
# ANTHROPIC_OAUTH_REDIRECT_URI=http://localhost:54545/callback
```

## Usage

1. Open **Advanced Settings** → **AI Provider Authentication**
2. Click **Login with OAuth** for the provider
3. A browser window opens the provider's authorize URL (PKCE S256 + state)
4. After consent, the provider redirects to the loopback URI; the main process intercepts it, exchanges the code, and stores the access token **in memory only**
5. Logout clears the token

## Security notes

- Tokens live in the main process only — never exposed to the renderer except via the `oauthGetToken` IPC (used internally by `AgentManager`)
- PKCE (S256) + `state` are generated per flow
- Tokens are **not persisted** — app restart requires re-login (acceptable for MVP; use `keytar` for production)
- Refresh tokens are supported by `OAuthManager.refreshToken()` but not yet wired to automatic refresh — track `expiresAt` before production use

## Known limitations

- Callback capture relies on `will-navigate` interception of the loopback redirect. A local HTTP listener on the redirect port would be more robust (some providers/proxies may not trigger navigation events for the final hop).
- OpenAI flow cannot be end-to-end tested without a granted `oaiapp_` client.
