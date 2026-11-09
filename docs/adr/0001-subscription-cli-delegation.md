# 0001: Delegate subscription execution to installed vendor CLIs

Status: Accepted
Date: 2026-11-09

ZAOS defaults to API-key authentication. Optional local subscription execution
runs the end user's installed, unmodified vendor CLI. The vendor binary owns its
browser login, credential storage and plan limits. ZAOS never collects, stores,
reads or forwards vendor session tokens, credential files or keychain items.
No private ChatGPT endpoints or custom OAuth implementation are used.

For Claude, the recommended mode is an Anthropic Console API key. “Use my
installed Claude Code” is personal/local use only, opt-in and hidden unless
ZAOS_ENABLE_CLAUDE_SUBSCRIPTION=1 is set at app launch (default OFF). Login uses
`claude auth login`; detection uses `claude auth status`; execution uses `-p`.
The binary remains unmodified with all authentication methods intact, and each
end user authenticates with their own credentials. ZAOS does not offer Sign in
with Claude. Anthropic's restrictions on routing third-party application requests
through subscription credentials may be enforced. Before commercial distribution,
Gustavo must disable this mode or obtain Anthropic approval.

Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)
limits subscription OAuth to ordinary use of Claude Code and native Anthropic
applications. Product developers should use API keys. It prohibits offering
Claude.ai login in third-party applications, routing product requests through
Free, Pro, Max or Ultra credentials, and collecting or intermediating session
credentials. It permits an end user signing into the unmodified Claude Code
binary using their own subscription. The
[Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) requires
prior approval for third-party products offering Claude.ai login or rate limits.
The [CLI reference](https://code.claude.com/docs/en/cli-reference) describes native
auth commands and print mode. [Headless documentation](https://code.claude.com/docs/en/headless)
explains that --bare ignores OAuth; ZAOS does not use that flag or bypass permissions.

For Codex, ZAOS delegates `codex login`, `codex login status` and `codex exec` to
the user's CLI. [Codex authentication](https://learn.chatgpt.com/docs/auth)
describes ChatGPT and API-key login. [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
reuses saved CLI authentication and treats ~/.codex/auth.json like a password;
ZAOS never reads it. [Sign in with ChatGPT for apps](https://learn.chatgpt.com/docs/sign-in-with-chatgpt)
requires OpenAI-granted participation for native third-party plan usage. ZAOS is
not a participating app and implements no such login. Apply to that program
before distributing a paid/hosted product offering native plan usage.

Subscription token cost is unknown. Report subscription_included at zero local
ledger cost, preserve receipt reconciliation, and require a persisted UTC monthly
run cap plus per-run timeout and the existing positive USD cap/consent policy.
Vendor plan limits remain authoritative. CLIs must be installed. Tokens never
touch ZAOS. Source descriptions above were supplied for this offline decision;
no online verification was performed in this phase.
