# ADR-0005: Hardened GitHub skill import via archive

Date: 2026-11-12 · Status: accepted

Inspired by agentes.chat ADR-0020 (skills as versioned artifacts).

## Context

The importer fetched `SKILL.md` via raw URLs / contents API — rate-limited
(60 req/h shared), single-skill only, and stored whatever text it found with
no script/binary policy or provenance.

## Decision

`SkillImporter` now:

- Downloads the repo **zip archive** once (`github.com/.../archive/<ref>.zip`,
  manual redirect following restricted to github.com / raw. /
  codeload.githubusercontent.com — SSRF guard).
- Caps: archive ≤ 50 MB declared+actual, total text ≤ 2 MB, ≤ 200 files,
  SKILL.md ≤ 512 KB.
- Rejects path traversal (`..`, absolute) before extracting anything.
- Imports **every folder containing SKILL.md** (up to 6 deep) and returns
  `{ skills, skipped }`; the UI lets the user pick which to save.
- Text extensions only (md/txt/csv/json/yaml/html/svg); scripts and binaries
  are listed under `ignored` — never stored as runnable content.
- Records provenance: `source` (URL), `sourceRef` (git ref), `version`.
  Re-importing a skill with the same name bumps `version` instead of
  duplicating (`skills:create` → `findSkillByName`).

## Consequences

- One HTTP request per repo instead of N API calls; private repos still 404.
- Supporting text files are collected into `files` metadata but only
  SKILL.md's prompt is injected today — richer multi-file skills are future
  work.
- ZIP-bomb safety relies on jszip's bounded reads + our size caps; declared
  sizes are checked before inflation where exposed.
