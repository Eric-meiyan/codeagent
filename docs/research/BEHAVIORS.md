# cconline.sh Behavior Notes

## Viewports Captured

- Desktop full page: `docs/design-references/cconline-desktop-full.png`
- Mobile full page: `docs/design-references/cconline-mobile-full.png`

## Global Behaviors

- Header is sticky at the top with backdrop blur.
- Nav links and footer links use color transitions on hover.
- Primary buttons use pill shape, orange accent, slight hover lift/shadow in the hero.
- Feature cards use hover border/shadow and icon background transitions.
- Pricing cards use static card layout; checkout behavior is product-side.
- FAQ is a click-driven accordion.
- Mobile layout stacks hero CTAs and collapses nav behind a menu button.

## Responsive Notes

- 1440px: hero text maxes around 1152px; preview around 1000px wide; features/pricing use 3 columns.
- 768px: content remains centered with reduced horizontal padding and 2-column card grids where available.
- 390px: hero CTAs stack full width; preview scales down; grids become single column; header hides desktop nav.

## Implementation Notes

- The CodeAgent build keeps the reference fonts, warm background, orange primary color, dot pattern, section order, and dark footer.
- The reference screenshot asset is replaced by a DOM-based CodeAgent workspace preview to avoid shipping a CCOnline-branded image.
- The `/code` route is a product shell that can later receive live WebSocket terminal, preview proxy, and archive status data.
