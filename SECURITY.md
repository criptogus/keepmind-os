# Security policy

## Supported versions

Security fixes target the latest release. Upgrade to the latest release before checking whether an issue persists.

## Report a vulnerability

Report suspected vulnerabilities privately through GitHub Security Advisories using [Report a vulnerability](https://github.com/criptogus/keepmind-os/security/advisories/new). Do not disclose exploit details or secrets in public issues.

Include the affected version, reproduction steps, expected and observed behavior, and potential impact. Provide a minimal example with credentials and personal data removed.

## Scope

Reports may cover the desktop app, Electron process boundaries, IPC handlers, local storage and credentials, governance bypasses, skill import, webhook handling, and integration code maintained in this repository. Report flaws in external providers or services to their maintainers; include related KeepMind OS integration issues here when applicable.

## Security model

- **Process isolation:** context isolation and the renderer sandbox are enabled; renderer Node.js integration is disabled. A preload bridge exposes IPC operations to the UI.
- **IPC validation and authorization:** main-process handlers perform operation-specific input checks. When local accounts exist, non-authentication IPC channels require a signed-in session, with additional role checks on protected operations. This is not comprehensive schema validation of every IPC payload.
- **Local servers:** OAuth callback and webhook servers bind only to loopback. Webhook URLs contain secret tokens and should be treated as credentials.
- **Local credentials:** provider keys, OAuth tokens, and integration secrets use a local credential store backed by SQLite. Electron `safeStorage` encrypts them when OS encryption is available; otherwise the store falls back to unencrypted encoding. The SQLite database as a whole is not encrypted by this mechanism.
- **Human oversight:** sensitive tool calls enter an approval queue unless auto-approval is enabled. Approval records include a hash of the tool arguments. Role policies restrict tool access independently of model and skill routing.
- **External services:** local-first storage does not mean offline execution. Configured AI providers and integrations receive the data needed for their requests; Composio manages connected service accounts externally.

Read the [architecture overview](docs/ARCHITECTURE.md) for context; it includes proposals that are not all implemented. Current security decisions are documented in [approval binding and routing](docs/adr/0003-approval-args-binding-and-routing-log.md), [skill import hardening](docs/adr/0005-skill-import-hardening.md), and [webhook triggers](docs/adr/0006-webhook-triggers.md).
