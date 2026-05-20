---
name: Technical Instrument System
colors:
  surface: '#faf9ff'
  surface-dim: '#d8d9e4'
  surface-bright: '#faf9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3fd'
  surface-container: '#ecedf8'
  surface-container-high: '#e7e7f2'
  surface-container-highest: '#e1e2ec'
  on-surface: '#191b23'
  on-surface-variant: '#424654'
  inverse-surface: '#2e3038'
  inverse-on-surface: '#eff0fa'
  outline: '#737785'
  outline-variant: '#c2c6d6'
  surface-tint: '#0057cd'
  primary: '#0055c8'
  on-primary: '#ffffff'
  primary-container: '#306fe6'
  on-primary-container: '#fefcff'
  inverse-primary: '#b1c5ff'
  secondary: '#4b5d8c'
  on-secondary: '#ffffff'
  secondary-container: '#b6c8fd'
  on-secondary-container: '#415381'
  tertiary: '#954500'
  on-tertiary: '#ffffff'
  tertiary-container: '#bb5800'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d9e2ff'
  primary-fixed-dim: '#b1c5ff'
  on-primary-fixed: '#001946'
  on-primary-fixed-variant: '#00419d'
  secondary-fixed: '#dae2ff'
  secondary-fixed-dim: '#b3c5fa'
  on-secondary-fixed: '#021944'
  on-secondary-fixed-variant: '#334572'
  tertiary-fixed: '#ffdbc8'
  tertiary-fixed-dim: '#ffb68a'
  on-tertiary-fixed: '#321300'
  on-tertiary-fixed-variant: '#743500'
  background: '#faf9ff'
  on-background: '#191b23'
  surface-variant: '#e1e2ec'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  label-mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2rem
  gutter: 1rem
  margin: 1.5rem
---

## Brand & Style

This design system is built on the philosophy of **High-Fidelity Instrumentation**. It prioritizes clarity, precision, and the immediate communication of technical data. The aesthetic is rooted in **Minimalism** with a heavy influence from aerospace control panels and modern engineering environments—functional, reliable, and hyper-organized.

The target audience consists of operators, engineers, and power users who require a "tool-first" interface that disappears to let the data lead. By utilizing a crisp white foundation and a professional blue-centric palette, the UI evokes a sense of modern efficiency and "Day One" cleanliness, maintaining the gravitas of a professional-grade instrument through rigid alignment and technical typography.

## Colors

The palette is anchored by a pure **White (#FFFFFF)** primary surface to ensure maximum legibility and a contemporary feel. Depth is achieved not through shadows, but through the use of **Subtle Gray Tints** for nested containers, sidebars, and inactive UI regions.

Operational status is handled by a triad of technical accents:
- **Blue:** Primary actions and system-level focus (#3371E8).
- **Steel Blue:** Secondary information and utility functions (#6476A6).
- **Bronze/Orange:** High-priority status changes and alerts (#C65E00).

Typography and iconography utilize a sophisticated **Neutral Gray (#757780)** to provide a balanced contrast ratio that is softer than pure black but remains highly legible against white canvases.

## Typography

The typography system employs a mix of **Geist** for structural UI and **JetBrains Mono** for data and labels to reinforce the "instrument" aesthetic.

- **Geist** handles the primary information hierarchy, providing a clean, geometric sans-serif look that feels contemporary and balanced.
- **JetBrains Mono** is reserved for metadata, labels, status updates, and numerical data. This creates a clear visual distinction between "UI navigation" and "Technical output."

All technical labels should be set in sentence case or uppercase with slight tracking to ensure readability at small sizes.

## Layout & Spacing

This design system utilizes a **Rigid 8px Grid System** with a 4px baseline for micro-adjustments. The layout philosophy is modular and "tiled," mimicking a dashboard or control panel.

- **Desktop:** A 12-column fluid grid with 16px (1rem) gutters. Content is housed in "Modules" that span the grid.
- **Spacing Rhythm:** Use tight spacing (4px, 8px) to group related data points and larger spacing (24px, 32px) to separate functional blocks.
- **Safe Areas:** Maintain a minimum 24px (1.5rem) outer margin on all viewports to prevent content from touching the screen edges, preserving the clean, "framed" look of an instrument.

## Elevation & Depth

To maintain the technical, flat aesthetic, depth is communicated through **Low-Contrast Outlines** and **Tonal Layers** rather than traditional shadows.

1.  **Level 0 (Base):** The #FFFFFF background.
2.  **Level 1 (Subsurface):** Inset containers or background regions using light surface tints.
3.  **Level 2 (Foreground Elements):** Cards and modules use a 1px solid border.
4.  **Interaction:** On hover or focus, borders transition to the primary Blue or the Neutral Gray. 

Shadows are used only for "Floating" elements (Modals, Popovers) and must be extremely diffused: `0px 10px 30px rgba(0,0,0,0.04)`.

## Shapes

The shape language is **Rounded (Level 2)**. This uses a 0.5rem (8px) corner radius as the standard for all components including buttons, inputs, and cards.

This generous rounding softens the technical nature of the UI, making the data-heavy layouts feel more approachable while maintaining a disciplined, rectangular structure. Large containers may use a 1rem (16px) radius, but internal elements should typically default to the 8px standard to ensure a consistent nesting appearance that feels integrated rather than sharp.

## Components

### Buttons
- **Primary:** Blue (#3371E8) background with White text. Geist Medium. Uses the standard 0.5rem (8px) radius.
- **Secondary:** White background with a 1px border.
- **Status-Specific:** Ghost buttons with Blue, Steel Blue, or Burnt Orange text for contextual actions.

### Input Fields
- Background: #FFFFFF.
- Border: 1px solid.
- Corner Radius: 0.5rem (8px).
- Label: JetBrains Mono at 11px, positioned above the field.
- Focus State: 1px solid #3371E8 with a subtle 2px outer ring in the same color at 10% opacity.

### Status Indicators & Chips
- Use the accent palette (Blue, Steel Blue, Burnt Orange).
- Chips are highly rounded (using `rounded-lg` or pill shapes) with a light tint of the accent color as a background and high-contrast text.
- Operational dots: 8px circles of solid accent color to indicate "Live," "System," or "Attention" states.

### Cards & Modules
- No shadows. Use 1px borders and a 0.5rem (8px) corner radius.
- Headers should have a subtle bottom border and utilize JetBrains Mono for the module title.