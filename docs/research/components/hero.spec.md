# Hero Specification

## Overview

- Target file: `src/blocks/hero.tsx`
- Reference screenshot: `docs/design-references/cconline-desktop-full.png`
- Interaction model: static hero with button hover transitions.

## Computed Styles

- Section padding: desktop top `136px`, bottom `96px`; mobile top/bottom reduced.
- H1 font: Libre Baskerville serif, `60px` on 1440 reference, normal weight, tight tracking.
- Body text: Inter, muted foreground, about `20px` desktop.
- Primary button: pill, orange primary, white/off-white text, hover lift.
- Secondary button: pill outline.

## CodeAgent Implementation

- Keeps dot-pattern masked background.
- Replaces CCOnline screenshot with a custom CodeAgent workspace preview.
- Preview includes sessions, terminal output, file diff, live preview, and runtime status.

## Responsive Behavior

- Desktop: preview uses sidebar + terminal + right metadata panel.
- Mobile/tablet: CTAs stack; preview collapses to terminal-first layout with side panels hidden.
