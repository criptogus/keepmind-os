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

The sticker loop retains visibility filtering and reduced-motion handling. Atlas readiness explicitly redraws still frames. Native mobile's Skia renderer remains compatible through the default body renderer; this patch targets web and desktop. Tiny data-visualization sprites in timelines and procedural skies are not covered by this patch.

Validation: UI/web typechecks, production web build, 43 tests covering sticker moods/lifecycle, stored appearances, empty states and permission restrictions. Visual inspection uses a separate localhost preview because the installed runtime is 0.3.0 while this checkout derives from alpha.4. Do not deploy this older checkout over the installed runtime; integrate the patch into the current release source first.
