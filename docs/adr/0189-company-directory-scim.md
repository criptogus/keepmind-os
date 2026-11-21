# 0189. The company's directory through SCIM

Status: accepted, 2026-11-21

## Context

Company sign-in (ADR 0188) lets a company's people in through its own provider, but a session opened before the
company turns someone off keeps working until it expires. A company's security review asks for the reverse path too:
when IT removes a person in Entra ID or Okta, their access ends at once, and new people get an account without an
invitation. Both directories speak SCIM 2.0 (RFC 7643, 7644).

## Decision

- The server answers SCIM 2.0 at `/api/scim/v2` (`apps/server/src/routes/scim.ts`) only when the company sign-in and
  `SSO_DOMAINS` are set and `SCIM_TOKEN_SHA256` holds the SHA-256 of the bearer token the directory sends. The token
  itself is never stored, and compared in constant time.
- Users only: `ServiceProviderConfig`, `ResourceTypes`, list (the `userName eq` and `emails` filters the directories
  send, pages of at most 200), read, create, replace, patch and delete. Groups are later.
- It reaches only accounts whose address is in `SSO_DOMAINS`. Any other account is not found, so a leaked token cannot
  touch the server's owner or other companies' people.
- Created accounts are confirmed, have no password (they sign in through the company's sign-in) and join
  `SSO_WORKSPACE_ID` as members, like an account the company sign-in makes.
- Turning a person off (`active: false`, including Entra ID's `"False"`) is an account block with the reason
  `scim:deactivated`: every session and push device ends and the apps hear `membership.revoked` (`setUserBlocked`).
  Delete is the same block with `scim:removed`, and the account then disappears from the directory's view. Nothing is
  erased, so the workspace keeps the person's messages and an audit trail.
- Turning a person on lifts only the directory's own blocks (reason `scim:*`). A block the operator set stays.
- Creating a removed address again restores the same account.
- The address does not change through SCIM (`mutability`), since the account is found by it at sign-in.

## Consequences

- Off-boarding takes effect within the directory's push, usually seconds for a manual push, up to 40 minutes on
  Entra ID's cycle.
- One directory per server, like the company sign-in. keepmind.io with many companies needs per-workspace tokens.
