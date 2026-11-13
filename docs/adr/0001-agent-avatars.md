# ADR-0001: Agent avatars via open-bot-avatar

Date: 2026-11-12 · Status: accepted

## Context

Agents were represented by generic icons — the UI felt like "loose icons" and
agents were indistinguishable at a glance. We studied
[open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) (MIT,
zero-dependency): a JSON geometry contract (one SVG path + eye placement in a
0 0 100 100 viewBox) with a renderer that owns color, implied volume, moods
(`idle`/`thinking`/`happy`), gaze and `prefers-reduced-motion`.

## Decision

- Each agent stores an avatar definition as JSON in `agents.avatar`
  (geometry only — never colors or behavior).
- Definitions are validated with `validateAvatar` before rendering or
  persisting; invalid JSON falls back to a deterministic preset chosen by
  hashing the agent id, so every agent always has a stable face.
- The renderer (`BotAvatar`) maps real execution state to moods:
  `thinking` while an execution runs, `happy` for ~30s after a success.
- New agents get a preset automatically at creation; the create form offers
  an avatar picker backed by the package's bundled examples.

## Consequences

- Renderer stays monochrome-consistent (color is a runtime option).
- Avatar JSON is portable — future LLM-generated avatars only need to pass
  `validateAvatar`.
- Reduced-motion users get a static pose automatically.
