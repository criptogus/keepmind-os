# KeepMind OS Plugins & Skills

Skills are KeepMind OS's plugin format: a folder with a `SKILL.md` file that
teaches an agent a specialized behavior, optionally bundled with text
reference files. Everything is text-only — scripts and binaries are listed
as ignored, never executed.

## SKILL.md format

```markdown
---
name: My Skill
description: One-line summary shown in pickers
tools: file_read, sheet_read
---

# Instructions

The body is injected verbatim into the agent's system prompt when the skill
is activated. Write it as direct instructions: what to do, what tools to
use, what boundaries to respect.
```

- `name` / `description` / `tools` are optional frontmatter; name falls back
  to the `# Heading`, description to the first paragraph.
- `tools` is a comma-separated list of built-in tool names (see
  `skills:listTools`). Unknown names are dropped on install.

## Install sources

| Source | How |
| --- | --- |
| GitHub URL | Skills → Import from GitHub (repo, `/tree/<ref>/<path>`, or `SKILL.md` link) |
| Local folder | Skills → Import folder (plugin directory with `SKILL.md` files) |
| Marketplace | Skills → Marketplace (curated catalog in `src/shared/skillsMarketplace.ts`) |

## Publishing a plugin

1. Create a GitHub repo (or folder) containing one `SKILL.md` per skill.
2. Optionally add reference `.md`/`.txt`/`.csv`/`.json` files — they are
   imported as context but capped (2MB total text, 200 files).
3. Open a PR adding an entry to `src/shared/skillsMarketplace.ts`:

```ts
{
  id: 'my-skill-pack',
  name: 'My Skill Pack',
  description: 'What it does, in one line',
  source: 'https://github.com/you/my-skills',
  tags: ['br', 'finance'],
  audience: 'any',
  version: '1.0.0',
}
```

Review criteria: text-only content, accurate tool names, clear boundaries,
no secrets or personal data. Bump `version` when the upstream content
changes meaningfully.

## Security model

- Import is **text-only**: `.md .txt .csv .json .yml .yaml .html .svg`.
- Archives are capped at 50MB; text payloads at 2MB; 200 files max.
- Path traversal (`..`, absolute paths) is rejected.
- Imported content becomes prompt text — it never runs code. Tool access is
  still gated by the agent's skills and the governance approval queue.
