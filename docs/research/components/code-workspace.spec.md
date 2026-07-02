# Code Workspace Specification

## Overview

- Target file: `src/routes/code.tsx`
- Interaction model: static product shell for the first build; future runtime data will be connected through WebSocket/API routes.

## Layout

- Sticky top bar with brand and Settings link.
- Left session sidebar with runtime status card.
- Main terminal panel.
- Right column with file diff, live preview, and archive status panels.

## Runtime Mapping

Future integration points from `../spikes/06-integrated-session-mvp`:

- `/terminal/:user/:session` -> terminal panel
- `/preview/:user/:session/*` -> preview panel
- `/archive`, `/restore`, `/inspect` -> archive/status panels
- model gateway telemetry -> runtime status

## Responsive Behavior

- Desktop: sidebar + terminal + right rail.
- Tablet/mobile: sections stack; right rail follows terminal.
