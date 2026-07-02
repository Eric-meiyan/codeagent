# Pricing Specification

## Overview

- Target file: `src/blocks/pricing.tsx`
- Interaction model: checkout click; optional provider modal if multiple providers are enabled.

## Layout

- Section id: `pricing`
- Top border, centered section header, three cards.
- Featured middle card uses stronger background, ring, and primary CTA.

## Plans

- Starter: `$9/mo`, 10,000 credits.
- Standard: `$19/mo`, 25,000 credits, popular.
- Pro: `$39/mo`, 60,000 credits.

## Behavior

- If user is not signed in, checkout redirects to sign-in with return path.
- If multiple payment providers are enabled, provider modal opens before checkout.
