# cconline.sh Page Topology

Reference URL: `https://cconline.sh/`

## Global Structure

- Sticky header, 64px tall, translucent `bg-background/80` with backdrop blur.
- Warm off-white page background: `oklch(97.7% .004 75)`.
- Serif display headings with Libre Baskerville; Inter for body and UI.
- Primary accent from reference: `oklch(64% .13 41)` orange-red.
- Main page order: header, hero, features, pricing, FAQ, CTA, footer.

## Sections

1. **Header**
   - Brand mark and italic serif product name on the left.
   - Desktop nav: Features, Pricing, language toggle, theme toggle, Get Started.
   - Mobile: compact brand and menu button.
   - Interaction model: sticky static header; link hover and mobile menu click.

2. **Hero**
   - Centered large serif H1, muted subheadline, two pill CTAs.
   - Dot pattern background masked around center.
   - Product workspace preview below CTA.
   - Interaction model: static with button hover transitions.

3. **Features**
   - Centered section heading and description.
   - Six feature cards in a 3-column desktop grid, 2-column tablet, 1-column mobile.
   - Interaction model: card hover border/shadow/icon color changes.

4. **Pricing**
   - Centered title and description.
   - Three subscription cards with the middle card featured.
   - Interaction model: checkout button click; provider selection handled by product config.

5. **FAQ**
   - Centered title and description.
   - Accordion with five items.
   - Interaction model: click-to-expand accordion.

6. **CTA**
   - Dashed rounded panel, large serif headline, subheadline, primary pill CTA.
   - Interaction model: static with button hover transition.

7. **Footer**
   - Dark footer band.
   - Large italic serif tagline.
   - Three columns plus locale selector, Built with ShipAny attribution, copyright.
   - Interaction model: link hover and locale selector.

## CodeAgent Content Mapping

The reference structure is retained, but content is replaced with CodeAgent product copy and a custom workspace preview shell. No cconline image asset is shipped.
