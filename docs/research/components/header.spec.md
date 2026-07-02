# Header Specification

## Overview

- Target files: `src/components/site-header.tsx`, `src/blocks/header.tsx`
- Reference screenshot: `docs/design-references/cconline-desktop-full.png`
- Interaction model: sticky header with hover links and mobile menu click.

## Computed Styles

- Header height: `64px`
- Position: `sticky`, `top: 0`, `z-index: 50`
- Background: `oklab(0.977 0.00103528 0.0038637 / 0.8)`
- Backdrop: blur via Tailwind `backdrop-blur-sm`
- Brand image: `28px` square, `7px` radius
- Brand text: serif italic, about `18px`

## CodeAgent Implementation

- Uses `envConfigs.app_logo` and `envConfigs.app_name`.
- Nav links: Features, Pricing, Code.
- CTA remains the existing authenticated-aware Get Started behavior from the shared component.

## Responsive Behavior

- Desktop: nav and actions visible.
- Mobile: nav hidden, menu button opens stacked nav.
