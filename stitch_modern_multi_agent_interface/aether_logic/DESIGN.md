```markdown
# Design System Specification: The Synthetic Architect

## 1. Overview & Creative North Star
This design system is built for the next generation of multi-agent AI orchestration. It moves away from the "chat-bubble" cliché and toward a vision we call **"The Synthetic Architect."** 

The aesthetic is rooted in high-end editorial layouts—think premium automotive interfaces meets Swiss architectural journals. We achieve this through a "Void-and-Luminescence" philosophy: a deep, expansive neutral foundation (`#0b1326`) punctuated by precise, vibrant data points. To avoid the "template" look, we utilize intentional asymmetry, varying content densities, and a strict rejection of traditional structural lines in favor of tonal depth.

## 2. Color & Atmospheric Theory
The palette is a sophisticated interplay of deep charcoals and electric accents. The goal is to make the interface feel like a powerful command center that is "always on" but never overwhelming.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. Traditional borders create visual noise that traps the eye. Instead, boundaries must be defined solely through:
- **Background Color Shifts:** Use `surface-container-low` for secondary sidebars against a `background` main stage.
- **Tonal Transitions:** Use `surface-container-highest` for active interactive regions.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers of smoked glass. 
- **Base Layer:** `surface` (#0b1326) - The foundation.
- **Floating Panels:** `surface-container` tiers. Use `surface-container-lowest` for background utility panels and `surface-container-high` for active agent workspaces.
- **Nesting:** To define an inner area (like a code snippet inside a chat), do not use a border. Use a "step-down" approach: place a `surface-container-lowest` block inside a `surface-container-high` container.

### The Glass & Gradient Rule
Floating agent HUDs or "Quick Action" menus should utilize Glassmorphism.
- **Formula:** `surface-container` at 70% opacity + `backdrop-blur: 20px`.
- **Signature Textures:** For primary CTAs, use a linear gradient from `primary` (#c0c1ff) to `primary-container` (#8083ff). This provides a "soul" to the interactive elements that flat fills lack.

## 3. Typography: Editorial Authority
We pair two typefaces to balance machine precision with human readability.

*   **Display & Headlines (Manrope):** Use Manrope for all `display-` and `headline-` tokens. This is our "Editorial" voice. It should feel authoritative. Use `headline-lg` with tight letter-spacing (-0.02em) for agent names or major system states.
*   **Body & Labels (Inter):** Use Inter for all `title-`, `body-`, and `label-` tokens. Inter provides the "Utility" voice. It is designed for maximum legibility in data-dense AI logs and multi-agent transcriptions.
*   **The Hierarchy:** Use extreme scale contrast. A `display-lg` heading next to a `label-sm` metadata tag creates a sophisticated, modern tension that feels premium.

## 4. Elevation & Depth
In this design system, depth is a functional tool, not a decoration.

### The Layering Principle
Depth is achieved by stacking `surface-container` tiers. A `surface-container-highest` card sitting on a `surface` background creates an immediate, soft focal point.

### Ambient Shadows
Shadows must mimic natural light.
- **Rule:** Shadows must be extra-diffused. For floating modals, use a blur of `40px` to `60px` at `6%` opacity. 
- **Tinting:** Never use pure black for shadows. Use a tinted version of `on-surface` (#dae2fd) to ensure the shadow feels like it belongs to the atmosphere of the deep blue background.

### The "Ghost Border" Fallback
If a layout absolutely requires a container edge for accessibility (e.g., in a high-density data table), use a **Ghost Border**.
- **Execution:** `outline-variant` (#464554) at **15% opacity**. It should be felt, not seen.

## 5. Components & Interface Patterns

### Buttons
- **Primary:** Gradient fill (`primary` to `primary-container`), white text (`on-primary`), `xl` (0.75rem) roundedness. 
- **Secondary:** Transparent background with a `Ghost Border`. Text color: `secondary` (#4cd7f6).
- **Tertiary:** No background, no border. Pure text in `on-surface-variant`.

### Agent Indicator Chips
- Use the `full` (9999px) roundedness scale. 
- **Active Agent:** `tertiary-container` (#00885d) background with `tertiary` (#4edea3) text. This signifies "Living/Processing" states.
- **Idle Agent:** `surface-container-highest` background with `on-surface-variant` text.

### Cards & Lists
- **Strict Prohibition:** No horizontal divider lines.
- **Separation:** Use `8px` to `16px` of vertical white space or a subtle shift from `surface-container-low` to `surface-container-high` to separate different AI thoughts or log entries.

### Input Fields
- **Background:** `surface-container-lowest`.
- **State:** On focus, the background should not change, but the "Ghost Border" should transition to 100% opacity `primary` (#c0c1ff).
- **Typography:** Always use `body-md` for user input to maintain readability.

## 6. Do’s and Don’ts

### Do:
- **Embrace Negative Space:** Allow agent responses to "breathe" with generous padding.
- **Use Intentional Asymmetry:** If three agents are active, perhaps two are stacked while one takes up a larger, offset editorial column.
- **Layer with Glass:** Use backdrop blurs for overlaying system notifications to keep the user grounded in their current context.

### Don’t:
- **Don't use 100% Opaque Borders:** This is the quickest way to make the interface look dated and "clunky."
- **Don't use pure black (#000000):** It kills the depth. Always use the `background` token (#0b1326) for the darkest areas.
- **Don't use standard "Drop Shadows":** Avoid small, dark, high-opacity shadows. They look like "web 2.0" and ruin the "Synthetic Architect" aesthetic.
- **Don't crowd the screen:** If the data is dense, use `surface-container` shifts to group information, not lines.```