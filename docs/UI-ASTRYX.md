# Renderer design system

The renderer uses Astryx **0.7.11**, the latest stable release on npm (`latest` dist-tag) and GitHub (v0.7.11, 2026-11-07) as of 2026-11-09; 0.7.12 exists only as canary builds. Dependencies were not upgraded. Pricing policy and IPC ordering remain unchanged. The monthly cap starts unset, remains empty through draft restore, and validates on blur or submit.

## Template structure and components

The official `.astryx-ref/template-ai-chat-landing.tsx` supplies the first-question structure: vertically balanced brand mark, welcoming Heading, readable Text, and an immediately adjacent composer. Once answers exist, `.astryx-ref/template-ai-chat.tsx` supplies the split chat/panel structure using **ChatLayout** with its composer slot, **ChatMessageList** explicitly aligned at the top, **ChatMessage**, ghost assistant **ChatMessageBubble**, user pills, **ChatSystemMessage**, and assistant brand marks matching the landing. The message list scrolls independently above a bounded dock. Large provider/auth steps scroll within the dock, rather than covering transcript text. Assistant marks are 28px rounded squares aligned with the first text line. Editing notices use centered ChatSystemMessage pills in secondary text. Undo last answer is a small ghost Astryx Button with an undo icon in the dock.

The native textarea inside the composer is deliberate: Astryx 0.7.11 ChatComposerInput is contenteditable and cannot supply native textarea labels and organization autocomplete. Workspace name and First task remain visible labels. Enter submits; Shift+Enter inserts a newline. The textarea grows without an inner border or resize handle. An Astryx **IconButton** supplies Send, with a keyboard hint below.

Provider rows and suggestion pills use native buttons with radio semantics, explicit roving tabindex, arrows and Home/End. This avoids Astryx Button's internal label wrapper, which cannot lay out the monogram/copy/check row correctly. Provider rows are at least 80px tall with a contained 38px mark, stacked title/description, and selected check. Descriptions truncate to one line; accessible names retain the full title and description. Selection uses the accent border and muted surface.

**Theme**, **neutralTheme**, **Card**, **Heading**, **Text**, **Button**, **IconButton**, **StatusDot**, **Spinner**, **Banner**, **TextInput**, **NumberInput**, **CheckboxInput**, **Collapsible**, **ProgressBar**, **MetadataList / MetadataListItem**, **Badge**, and **EmptyState** supply the remaining surfaces, fields, status, hierarchy, and empty states. Native catalog selects preserve existing behavior.

Configuration moves to a 340px side surface with scrollable MetadataList rows and a separate persistent activation footer. Empty rows are omitted; the empty panel explains what will appear. Values wrap within a flexible column; Change actions never shrink or wrap and retain their full accessible names. Advanced unmounts its children when closed. The panel toggle is an IconButton with tooltip in the top bar, rendered through a portal after the shell mounts.

The workspace is a centered full-height two-column canvas with a fluid task card and a 340px policy card. Task labels align left; the description has an explicit six-line minimum, grows with content to sixteen lines, then scrolls without a resize handle. Run task is in a right-aligned form footer. EmptyState follows the authoring area. Execution MetadataList shows cap, spent, and a paid-execution Badge, followed by secondary policy actions. Task results retain review, cost, spend progress, acceptance, and retry behavior.

## Tokens and typography

`src/renderer/design/zero-agency-theme.css` is the single brand token layer. The bundled OFL 1.1 `assets/fonts/InterVariable.ttf` supplies variable weights 100–900; body, labels and headings use 400/500/600. Vite bundles the font locally under the existing self-only CSP.

Light mode uses a near-white canvas, white cards, neutral side surface, and near-black primary actions with white text. Dark mode uses #0A0A0A canvas and #141414 elevated surfaces. #C8FF00 lime appears only on dark surfaces as the primary/focus/selection accent, with near-black text on filled primary actions. Disabled primary actions use neutral grey in both modes; dark disabled actions use #2A2A2A with #737373 text and a default cursor. Their reason remains readable, and keyboard focus uses a neutral outline. Explicit primary styles correct the neutral theme's otherwise indistinct action surfaces. Secondary control borders use the contrasting border token; purely decorative separators use a reduced-opacity mixture. Contrast is verified by axe (WCAG 2.2 AA tags) in `scripts/a11y-onboarding.mjs`: 0 violations on every onboarding step and the workspace, light and dark.

## Remaining CSS and its purpose

`ui.css` contains only application-specific layout and native-control adaptations:

- Shell geometry, compact top bar, brand mark, and startup placement establish the desktop canvas.
- Chat and landing geometry adapt the official templates to the Electron viewport. Direct ChatLayout slot selectors make the message region and dock independent scrolling regions; they avoid fixed positioning and reserved-height guessing.
- Native composer, radio cards and pills preserve required labels, autocomplete and keyboard behavior. Target dimensions, card containment, descriptions clamped to two lines with natural card height and equal heights within each grid row and selected styling are explicit.
- Metadata panel geometry separates scrolling edits from activation. Definition-list spacing and subtle separators complement MetadataList.
- Workspace geometry balances authoring, empty/review content and policy. The form footer and consent alignment are application-specific.
- Native input geometry and button token fills ensure 44px inputs/actions and visible primary/secondary differentiation.
- Focus, skip link, scroll margins, responsive rules and reduced motion apply consistently across native and Astryx controls.

Color values come from Astryx custom properties. Recurring spacing uses the Astryx spacing scale; the large-control size token is 44px so field wrappers and their native inputs agree. Remaining pixel geometry describes viewport bars, reading widths, card/mark radii, typography, breakpoints and minimum target sizes. Obsolete header-band, floating provider-child and sticky-form rules were removed.

## Responsive and motion behavior

Configuration opens automatically at 1100px and closes when crossing below that width; the top-bar control reopens it. At desktop widths it occupies 340px (320px below 1100px). Below 760px an opened panel stacks after the chat. Provider rows switch to one column when the chat container is narrower than 720px. Workspace columns stack below 760px. The Electron window remains 1280×820 with a 960×640 minimum.

Messages have a brief entrance animation. Reduced-motion preferences disable animation, transitions and smooth scrolling. All interactive elements have scroll margins; each scrolling region has scroll padding. Inputs and primary actions are at least 44px, Change actions at least 28px tall, and focus uses a visible 2px token-colored outline.

## Verification

Required commands: `npm run typecheck`, `npm test`, `npm run build`, `node scripts/a11y-onboarding.mjs`, and `node scripts/scan-secrets.mjs`.

The browser flow preserves all existing assertions and scopes the connection-failure alert to the onboarding region and its actual error text, excluding the empty Astryx global live region. Redesign captures use a 1280×820 context and `fullPage: false`; legacy evidence captures remain full-page.

Results on 2026-11-09 (run outside the Codex sandbox, where Chromium cannot launch): typecheck, 137 unit tests, integration, Electron smoke (`ZAOS_SMOKE_LINUX=1 xvfb-run`), secret scan and the onboarding browser flow all pass, with 0 axe violations across 9 steps × light/dark. Evidence: `evidence/a11y/onboarding-summary.json`, `evidence/screenshots/redesign-*.png`.

P1 review follow-up: connector cards, authentication fields, testing and connection status mount only on q3. Later steps retain chat history and their own controls. Codex and Claude cards explain app sign-in and API keys in plain language; Codex login reads “Continue in Codex”. The browser script also checks that q4 begins with an empty cap and no premature error, that later steps unmount auth controls, and that disabled dark activation uses neutral colours. These new browser assertions must be run outside the sandbox.

The transcript inner column keeps its natural content height within the scrolling log, preventing clipped assistant-avatar fragments above the dock.
