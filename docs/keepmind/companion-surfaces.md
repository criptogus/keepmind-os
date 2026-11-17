# KeepMind companion surfaces

Goal: replace the legacy illustrated mascot in web/desktop empty states and assistant feedback with the approved KeepMind companion atlas, preserving actions and saved appearances.

| Surface | Replacement | Preserved |
| --- | --- | --- |
| Tasks and shared EmptyState | Companion + thin orbital accent | Copy, create/ask actions, permission gates |
| Chat stickers | Companion body with mood poses, without legacy pixel props | Seven moods, accessories, saved colors/eyes, labels |
| Search | Thinking companion and outlined magnifier | Search behavior and result text |
| Tool decisions/completion | Companion and decision badge | Permission-level swatches and controls |
| Autonomy settings | Companion body | Approval, shield and unrestricted symbols and values |
| Personalized app icon | Companion on graphite | User-selected appearance and desktop icon shape |

The sticker loop retains visibility filtering and reduced-motion handling. Atlas readiness explicitly redraws still frames. Native mobile's Skia renderer remains compatible through the default body renderer; this patch targets web and desktop. Compact timeline and sky sprites now use a symmetric KeepMind pod with lime eyes; onboarding progress uses the KeepMind palette.

Validation is rerun against current keepmind/main (1f1034165), including the transferred companion surface patch. The local web update preserves the running server and user data. No permissions, provider settings, task records or access controls are changed.

Verified on 2026-11-17: 83 targeted tests passed, UI and web typechecks passed, production web build passed (2m 4s). Installed the web assets into the existing 0.3.0 runtime after a full web-directory backup. Inspected Tasks at desktop and 390px width and opened/closed New task without creating records. Native-window automation could not bind the running macOS process, so visual verification used the same local server through the browser; the native window may need a reload.
