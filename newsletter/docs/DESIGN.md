# Design System Specification: The Precision Editorial

## 1. Overview & Creative North Star
**Creative North Star: The Mathematical Monolith**

This design system is a tribute to the International Typographic Style. It rejects the "template" look of modern web design in favor of a rigorous, grid-based architecture that prioritizes clarity, objective photography, and extreme typographic hierarchy. 

We are moving away from the "soft" web. By utilizing a **0px border-radius** across the entire system, we create a visual language of precision and authority. The "bespoke" feel is achieved through the tension between massive `display` type and generous, intentional whitespace (Negative Space as a Content Element). We break the traditional symmetrical grid with "Floating Anchors"—elements like metadata or captions that sit in the margins, creating a sophisticated, editorial layout that feels curated rather than generated.

---

## 2. Colors & Surface Philosophy
The palette is a sophisticated range of cool grays and architectural whites, punctuated by a surgical use of `tertiary` (#c1000a) for high-impact accents.

### The "No-Line" Rule
Sectioning must never be achieved through 1px solid borders. Boundaries are defined exclusively through background shifts. For instance, a side-rail using `surface-container-low` (#f2f4f6) should sit directly against a `surface` (#f9f9fb) main content area. This creates a "monolithic" feel where the architecture of the page is defined by volume, not lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of stacked, premium paper stocks.
- **Level 0 (Base):** `surface` (#f9f9fb)
- **Level 1 (Content Areas):** `surface-container-low` (#f2f4f6)
- **Level 2 (Interactive/Cards):** `surface-container-lowest` (#ffffff)
- **Level 3 (Overlays/Popovers):** `surface-container-highest` (#dde3e9)

### The "Glass & Gradient" Rule
To prevent the monochromatic palette from feeling "flat," use Glassmorphism for floating navigation or sticky headers. Apply `surface` with 80% opacity and a `backdrop-filter: blur(20px)`. 

### Signature Textures
Main CTAs or Hero sections should utilize a subtle linear gradient from `primary` (#5e5e5e) to `primary-dim` (#525252). This adds a "metallic" architectural sheen that distinguishes the element from flat UI components.

---

## 3. Typography
Typography is the primary visual engine of this design system. We use **Inter** for its neutral, neo-grotesque qualities that mimic the Swiss masters.

- **Display (lg/md):** Used for article titles and hero statements. Set with tight tracking (-0.02em) to create a "block" of text.
- **Headline (lg/md/sm):** Used for section headers. These should be anchored to the grid to lead the eye.
- **Body (lg/md):** Our "workhorse" for reading. `body-lg` (1rem) is the standard for long-form editorial content to ensure high-end legibility.
- **Label (md/sm):** Used for metadata, captions, and "The Ghost Border" fallbacks. Often set in All-Caps with +0.05em letter spacing for a technical, corporate aesthetic.

The hierarchy is intentionally dramatic. A `display-lg` (3.5rem) title may sit directly above a `label-sm` (0.6875rem) date—this scale contrast is what creates the "High-End" feel.

---

## 4. Elevation & Depth
In this system, depth is a product of light and layering, not shadow.

- **The Layering Principle:** Avoid elevation shadows. Instead, use "Tonal Lift." Placing a `surface-container-lowest` (#ffffff) card on a `surface-container-low` (#f2f4f6) background provides enough contrast to signify a new layer without the "fuzziness" of a shadow.
- **Ambient Shadows (The Exception):** If an element must float (e.g., a modal), use a high-diffusion shadow: `box-shadow: 0 24px 48px rgba(45, 51, 56, 0.06)`. The shadow color must be a tint of `on-surface` (#2d3338) to ensure it feels like a natural shadow cast on paper.
- **The "Ghost Border" Fallback:** If accessibility requires a container boundary, use `outline-variant` (#acb3b8) at 15% opacity. This creates a "suggestion" of a line that maintains the Swiss minimalist rigor.

---

## 5. Components

### Buttons
- **Primary:** Background `primary` (#5e5e5e), Text `on-primary` (#f8f8f8). Shape: 0px radius. Padding: `spacing-3` top/bottom, `spacing-6` left/right.
- **Tertiary (The "Signal" Button):** Background `tertiary` (#c1000a), Text `on-tertiary` (#fff7f6). Use only for singular, critical calls to action.
- **State Change:** On hover, primary buttons shift to `primary-dim` (#525252). No transitions longer than 150ms; the interaction should feel "snappy" and mechanical.

### Cards & Editorial Modules
- **Rule:** Absolute prohibition of divider lines.
- **Construction:** Use `spacing-10` or `spacing-12` to separate vertical content modules. Use background color blocks (`surface-container-low`) to group related information.
- **Imagery:** All images should be 0px radius. Captions should use `label-sm` and be placed with intentional asymmetry (e.g., bottom-left aligned, but outside the image container).

### Input Fields
- **Styling:** Underline-only style using `outline` (#757c81) at 1px thickness.
- **Active State:** The underline becomes `primary` (#5e5e5e) and thickness increases to 2px.
- **Error State:** Use `error` (#9f403d) for the underline and helper text.

### Navigation / Progress Indicators
- **The "Swiss Bar":** Use `tertiary` (#c1000a) as a 2px horizontal bar for progress indicators or to highlight the active menu state. It acts as a surgical "cut" through the monochromatic environment.

---

## 6. Do's and Don'ts

### Do:
- **Use the Grid:** Align every element to a strict 12-column grid. Typography should "hang" from the grid lines.
- **Embrace White Space:** If a section feels crowded, double the spacing value (e.g., move from `spacing-8` to `spacing-16`).
- **Use Contrast:** Pair the darkest `on-surface` text with the lightest `surface` backgrounds for maximum precision.

### Don't:
- **No Rounded Corners:** Never use a radius. Even 2px is too soft for this system.
- **No Divider Lines:** Do not use 1px lines to separate list items; use `spacing-4` and subtle background shifts.
- **No "Standard" Blue:** Avoid default web blues. Use `tertiary` red or monochromatic grays to maintain the "Corporate Swiss" identity.
- **No Over-Animation:** Avoid bouncy or "playful" transitions. Use linear or "ease-out" transforms that feel architectural and deliberate.

### Accessibility Note:
Despite the monochromatic look, ensure that all text (`on-surface` on `surface`) maintains a contrast ratio of at least 4.5:1. Use the `outline` token (#757c81) for icons to ensure they are visible against all `surface-container` tiers.