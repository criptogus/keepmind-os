# 0188. Company sign-in (SSO) through OpenID Connect

- Status: Accepted
- Date: 2026-11-21

## Context

A company that runs this server wants its people to sign in with the company's own
account (Microsoft Entra ID, Okta, Google Workspace, Keycloak), to stop keeping a second
password, and to know that someone who leaves the company loses access when the company
turns their account off. Security reviews ask for this before anything else. The server had
only passwords and personal Google, GitHub and Apple accounts.

## Decision

One identity provider per server, configured by its operator, through OpenID Connect.

- `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID`, `SSO_OIDC_CLIENT_SECRET` turn it on. The
  server reads the issuer's discovery document and signs in through Better Auth's generic
  OAuth plugin as the provider `sso`, so it returns at `/api/auth/callback/sso` and goes
  through the same hooks as every social sign-in (blocks, "This wasn't me", the operator's
  events). PKCE and a nonce are on, and every ID token is checked against the provider's
  published keys: a provider whose discovery gives no keys is left out, never trusted
  unchecked (`requireIdTokenVerification`).
- `SSO_DOMAINS` names the company's email domains, matched exactly (never a subdomain).
  With it set, the company's sign-in takes only those addresses, the provider's word counts
  as the address's confirmation (many providers, Entra ID among them, never send
  `email_verified`), and an account it makes for one of them is let in while sign-up is
  closed. The owner's link and a held address still refuse it.
- `SSO_REQUIRED=true` (needs `SSO_DOMAINS`) makes it the only way in for those addresses:
  a password sign-in, sign-up or reset and a Google, GitHub or Apple sign-in are refused with
  `SSO_REQUIRED`, at the endpoint, when a provider is added to the account and when its
  session is made. Access then ends when the company's provider ends it, at the next
  sign-in.
- `SSO_WORKSPACE_ID` is the workspace an account made through it joins, as a member.
- The sign-in page shows "Continue with `SSO_NAME`" (`GET /api/app/auth-config` gives only
  that name). Typing a company address goes straight to it (`sign-in-options` answers `sso`,
  and `ssoOnly` under `SSO_REQUIRED`). The desktop app signs in through the browser as it
  does for the other providers.
- The rules live in `apps/server/src/sso.ts`, wired in `auth.ts`. A half-configured
  company sign-in stops the server at start (`loadConfig`).

## Not in this decision

- SAML. Every provider named above speaks OpenID Connect. SAML-only providers need
  `@better-auth/sso` and its own table, a later decision.
- One provider per workspace, set from the app. keepmind.io hosts several companies on one
  server and needs that: each workspace's admins would register their provider and prove
  their domain (a DNS record). Until then, company sign-in is for a server one company runs.
- Provisioning from the directory (SCIM): an account still exists until someone removes it
  here. Under `SSO_REQUIRED` it can no longer sign in, but its sessions already open run
  until they end.
- The phone app. A company address on the phone gets no company button yet; under
  `SSO_REQUIRED` it cannot sign in there.

## Consequences

- A company can turn on its own sign-in with four variables and no code.
- Existing sessions of a company address outlive `SSO_REQUIRED` and the provider turning
  the person off, until they expire or someone ends them. Session lifetime is the window.
