---
{
  "name": "KeepMind OS",
  "description": "KeepMind operating UI with original abstract companions and the incumbent K identity.",
  "colors": {
    "light-bg": "#fbfbfa",
    "light-raised": "#ffffff",
    "light-raised-2": "#ffffff",
    "light-sunken": "#f3f3f0",
    "light-side": "#f5f5f2",
    "light-pane": "#ffffff",
    "light-ink": "#151514",
    "light-ink2": "#2a2a28",
    "light-muted": "#5c5c58",
    "light-faint": "#6f6f6a",
    "light-agent": "#486600",
    "light-agent2": "#587b00",
    "light-agent-soft": "#eef7d8",
    "light-action": "#c4ff3d",
    "light-on-action": "#111111",
    "light-on-agent": "#ffffff",
    "light-ok": "#1f7a45",
    "light-warn": "#9a5b00",
    "light-warn-soft": "#fbeed5",
    "light-danger": "#b42a20",
    "light-info": "#0a6f9e",
    "light-line": "rgba(23, 23, 22, 0.07)",
    "light-line2": "rgba(23, 23, 22, 0.12)",
    "light-line-strong": "#82827d",
    "dark-bg": "#0f0f0e",
    "dark-raised": "#1c1c1b",
    "dark-raised-2": "#242423",
    "dark-sunken": "#0a0a09",
    "dark-side": "#111111",
    "dark-pane": "#181817",
    "dark-ink": "#efefec",
    "dark-ink2": "#d6d6d2",
    "dark-muted": "#a3a39e",
    "dark-faint": "#8f8f89",
    "dark-agent": "#c4ff3d",
    "dark-agent2": "#d7ff80",
    "dark-agent-soft": "#26330e",
    "dark-action": "#c4ff3d",
    "dark-on-action": "#111111",
    "dark-on-agent": "#111111",
    "dark-ok": "#5fc48a",
    "dark-warn": "#e0a84a",
    "dark-warn-soft": "#33260e",
    "dark-danger": "#f08a80",
    "dark-info": "#5cc4ea",
    "dark-line": "rgba(255, 255, 255, 0.1)",
    "dark-line2": "rgba(255, 255, 255, 0.15)",
    "dark-line-strong": "#71716c",
    "companion-fallback": "#333630",
    "companion-face": "#181b16",
    "companion-tile-light": "#e9ece4",
    "companion-tile-dark": "#22251f"
  },
  "typography": {
    "display": {
      "fontFamily": "Onest, \"Segoe UI\", system-ui, sans-serif",
      "fontSize": "32px"
    },
    "headline": {
      "fontFamily": "Onest, \"Segoe UI\", system-ui, sans-serif",
      "fontSize": "28px"
    },
    "title": {
      "fontFamily": "Onest, \"Segoe UI\", system-ui, sans-serif",
      "fontSize": "20px"
    },
    "body": {
      "fontFamily": "Onest, \"Segoe UI\", system-ui, sans-serif",
      "fontSize": "15px",
      "lineHeight": "22px"
    },
    "label": {
      "fontFamily": "Onest, \"Segoe UI\", system-ui, sans-serif",
      "fontSize": "14px",
      "fontWeight": 600
    },
    "mono": {
      "fontFamily": "\"Martian Mono\", ui-monospace, Menlo, monospace"
    }
  },
  "rounded": {
    "xs": "4px",
    "sm": "6px",
    "item": "10px",
    "md": "10px",
    "btn": "12px",
    "lg": "14px",
    "xl": "18px",
    "section": "20px",
    "cut": "2px",
    "full": "999px",
    "agent": "30% 30% 30% 9%"
  },
  "spacing": {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "6": "24px",
    "8": "32px"
  },
  "components": {
    "button-primary": {
      "backgroundColor": "{colors.light-action}",
      "textColor": "{colors.light-on-action}",
      "height": "40px",
      "rounded": "{rounded.btn}",
      "padding": "0 14px",
      "typography": "{typography.label}"
    },
    "button-secondary": {
      "backgroundColor": "{colors.light-raised}",
      "textColor": "{colors.light-ink}",
      "height": "40px",
      "rounded": "{rounded.btn}",
      "padding": "0 14px"
    },
    "button-ghost": {
      "backgroundColor": "transparent",
      "textColor": "{colors.light-muted}",
      "height": "40px",
      "rounded": "{rounded.btn}",
      "padding": "0 14px"
    },
    "input": {
      "height": "40px",
      "rounded": "{rounded.btn}",
      "padding": "0 14px"
    },
    "tag": {
      "rounded": "{rounded.sm}",
      "padding": "0 6px"
    },
    "navigation-card": {
      "rounded": "{rounded.md}",
      "padding": "12px"
    },
    "card": {
      "rounded": "20px 20px 20px 4px",
      "padding": "16px"
    },
    "companion-fallback": {
      "backgroundColor": "{colors.companion-fallback}"
    }
  }
}
---

# Design System: KeepMind OS

## Overview

Preserve the incumbent KeepMind K mark and black/lime identity while using the upstream component kit. The workspace is a legible, compact working environment for objectives, execution, approvals and evidence. Brand accents identify action without replacing the semantic meaning of status, access controls or provider identities.

**Creative North Star: "KeepMind companions at work"**

The approved abstract companion family extends the existing operating UI rather than redesigning whole pages. Kivo, Luma, Nexo and Faro add matte charcoal bodies and expressive faces; recognizing work states takes priority over decoration. The original K mark, black/lime identity and Onest typography remain unchanged.

**Key Characteristics:**
- Original K mark and KeepMind OS wordmark.
- Warm white light surfaces and charcoal dark surfaces.
- Lime primary actions with black labels; theme-specific agent text.
- Existing responsive controls, keyboard focus and semantic states.
- Original abstract companions with live expressions and preserved user appearances.

## Colors

The primary palette is incumbent lime and black, supported by warm neutral light surfaces and charcoal dark surfaces. Frontmatter keys explicitly identify each theme; runtime components consume the corresponding semantic CSS custom properties.

### Primary

`action` and `on-action` define primary button surfaces and labels in both themes. `agent` is a darker green for legible light-theme text and lime in dark mode. `agent-soft` supports restrained agent emphasis.

Companion face, fallback silhouette and framed tile colors are recorded separately in the frontmatter. The atlas contains shaded matte charcoal artwork, not a new flat body-color palette. Default eyes use the existing lime action color. A saved custom hex color remains the eye color when its contrast against the companion face is at least 3:1; lower-contrast values render in the default lime without changing the saved appearance.

### Neutral

`bg`, `side`, `pane`, `raised`, `raised-2` and `sunken` separate work areas and surface depth. `ink`, `ink2`, `muted` and `faint` express hierarchy. `line`, `line2` and `line-strong` retain border and focus roles.

Success, warning, danger and information colors remain semantic, not additional brand accents. The legacy `success` alias resolves to ink; do not equate it with the separate `ok` token.

**The Semantic Accent Rule.** Use action tokens for primary actions and agent tokens for agent emphasis; retain the separate meaning of warning, danger and provider identity.

## Typography

The application uses Onest with Segoe UI and system fallbacks. Technical text uses Martian Mono with platform monospace fallbacks. Frontmatter records observed display, headline, title, body and label sizes; it does not invent missing role weights. Additional source sizes are 12px, 13px, 14.5px, 16px and 17px. Tight tracking is -0.025em and tighter tracking is -0.035em. The native token package also exposes Funnel Display and Doto for brand pages; these are not the application's body font.

## Layout

Preserve the upstream responsive layouts. Use the existing six-step spacing scale and form rhythm: fields use space-4, labels and help use space-1. Controls follow the small/medium/large ruler: heights 32/40/48px, horizontal padding 12/14/16px and text sizes 13/14/15px. Small controls retain an expanded 44px touch target. These are source contracts, not a report of measured touch usability.

Responsive component rules include 960px and 640px shell adaptations, with other feature-specific breakpoints. Do not collapse them into a new global grid. Preserve access to advanced controls and evidence when simplifying presentation.

## Elevation & Depth

Surfaces combine tonal separation, hairlines and the existing e1/e2/e3 shadows. Secondary buttons lift from e1 to e2 on hover. Menus and overlays use e3 with a solid fallback and supported glass treatment. Cards use a subtle outline shadow, not the button shadow. Selected controls use an inset pressed treatment. The sidecar contains synthesized, preview-only tonal ramps; these are not production tokens. It records source shadow and motion values; it does not assert that animations were visually tested.

## Shapes

Retain the source radius scale. Medium controls have gently rounded corners; compact and large controls use 10px and 14px radii. Cards keep three rounded section corners and a 4px bottom-left corner. The original logo has a black rounded square and white K. Do not replace the K with a generated agent symbol. Concentric containers derive inner corners from outer radius minus gap.

## Components

### Buttons

The final primary cascade uses `--action` and `--on-action`, with brightness on hover and the existing focus ring. Preserve disabled, loading and pressed states. Secondary buttons are raised neutral surfaces; ghost buttons are quiet until hovered. The final control ruler overrides older sizes earlier in the stylesheet.

### Inputs

Use medium control dimensions, semantic field background and border, placeholder faint text, and the existing focus treatment. Keep invalid, read-only and disabled states distinct and retain accessible labels.

### Navigation and tags

Navigation cards use the chosen inset state and keyboard focus. Tags are compact neutral labels, with semantic variants supplied by existing components. Preserve the component's actual role; a visual tag is not automatically an action.

### Cards and identity

Cards retain their asymmetric lower-left corner, internal spacing and outlined surface. The K mark's accessible naming follows Logo.tsx: decorative instances are hidden from assistive technology and labeled instances expose an image role. The full wordmark exposes KeepMind OS once.

### Abstract companions

The original family is Kivo, Luma, Nexo and Faro. The local two-by-two image atlas is `packages/ui/src/brand/assets/companions.png`; `packages/ui/src/agent/companion.ts` draws its body cells and overlays a live face. The atlas is bundled locally. The rounded fallback silhouette remains available while the image loads or fails.

Existing saved appearance colors select bodies without rewriting appearance data: absent, graphite and teal select Kivo; sky, indigo and violet select Luma; rose and amber select Nexo; all remaining values select Faro. Custom hex values retain their color in the live eyes only when `companionEyeColor` measures at least 3:1 contrast against the face; otherwise the renderer uses the default lime for readability. Family names describe the artwork; user-defined agent names remain intact. The default coordinator displays Kivo; the migration changes only built-in right-hand agents still named Lodi or KeepMind.

The shared visible-avatar loop in `packages/ui/src/agent/live.ts` retains idle, thinking, writing, waiting and sleeping states, saved eye styles, accessories and feedback reactions. The shared scheduler uses a 40ms active interval and an 80ms rest interval; actual frames depend on animation-frame scheduling. Reduced motion stops the continuous loop while preserving static state and expression updates. Positive and negative reactions retain their existing 1.6-second duration. The renderer applies the existing body frame transform to the atlas and draws accessories afterward; do not replace this integration with independent decorative animation loops.

**The Work-State Rule.** Preserve readable state, expression, accessible naming and user appearance when using companion artwork; the family never replaces status text, evidence or permission controls.

## Do's and Don'ts

- Do retain the original K mark and semantic action tokens.
- Do reuse the local companion atlas and shared live renderer for agent identity.
- Do preserve custom agent names, saved eye styles, accessories and reduced-motion behavior.
- Do retain custom hex eye colors only at 3:1 contrast or higher against the companion face; otherwise render the default lime without changing saved appearance.
- Do preserve capabilities, evidence, approvals and permission boundaries when simplifying a surface.
- Do use the final CSS cascade and mirrored tokens when adding screens.
- Do retain required upstream attribution in About.
- Do not use lime as light-theme body text.
- Do not recolor errors, warnings or provider brands as generic brand accents.
- Do not turn documentation or static inspection into a claim of usability validation.
- Do not infer deployed or native-packaged status from this design record.

Source record: `docs/design/design-system/tokens.css`, `packages/ui/src/styles/tokens.css`, `packages/tokens/src/index.ts`, `packages/ui/src/styles/components.css`, `packages/ui/src/components/Logo.tsx` and `PRODUCT.md`. The CSS mirror differs only by its generated-file header. Companion sources also include `packages/ui/src/agent/companion.ts`, `packages/ui/src/agent/live.ts` and `packages/db/migrations/0277_keepmind_companion.sql`. Browser review captures exist at `.impeccable/review/companions/desktop.png`, `mobile.png`, `user-428.png` and `mac.png`; the mac capture is a browser surface, not proof of an installed native app. Native cover and installer evidence is limited to source/build verification; the binary was not installed. This document adds no test-pass or deployment claim. Reviewer rescoring remains required after this documentation reconciliation.
