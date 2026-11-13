# Contributing to KeepMind OS

## Development setup

Use Node.js **>= 24.11.0** and npm. Fork the repository, create a working branch from the default branch, and install dependencies:

```bash
npm ci
npm run build
npm start
```

`npm run dev` starts the Vite renderer development server only. Rebuild with `npm run build` before launching updated bundled code with `npm start`. Configure providers through the app's settings using OAuth or API keys.

See [README.md](README.md) for available commands and [Architecture](docs/ARCHITECTURE.md) for background. Some architecture sections describe proposals; check the implementation when making changes.

## Branches and pull requests

- Use a focused branch, such as `feat/agent-filter` or `docs/setup`.
- Keep changes scoped and explain the problem, resulting behavior, and validation in the PR.
- Use Conventional Commits, following existing prefixes such as `feat:`, `docs:`, and `chore:`.
- Add or update relevant tests for behavior changes.
- Update both English (EN) and Brazilian Portuguese (PT-BR) strings for interface text changes.

Before opening a PR, run:

```bash
npm test
npm run typecheck
npm run scan:secrets
```

Never commit `.env` files, API keys, OAuth tokens, credentials, or private runtime data. Remove sensitive content from logs and examples before sharing them. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Community and license

Be respectful and constructive in issues, reviews, and discussions.

By submitting a contribution, you agree that it is licensed under the project's [MIT License](LICENSE).
