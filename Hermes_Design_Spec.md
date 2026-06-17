# Hermes Design Spec (light brand pass)

A visual styling pass for the existing Hermes app. It does not change any behaviour, layout, or wiring. It dresses the current screens in Just Website Brokerage branding. This is the approved "Option A" direction: a dark branded header with a gradient accent, on clean light cards.

**For Claude Code:** apply this as a styling layer only. Do not touch the answer logic, the Brain, the Airtable wiring, the Drive reading, or the page structure. Keep it light enough to re-skin later when the main JWB website redesign lands.

## Brand palette

| Role | Hex |
|---|---|
| Dark (aubergine) | `#230c3a` |
| Purple (magenta) | `#b3489a` |
| Blue (cyan) | `#4ac8ef` |
| Brand gradient | `linear-gradient(90deg, #4ac8ef 0%, #b3489a 100%)` |
| Page background | `#faf9fb` |
| Card background | `#ffffff` |
| Card border | `#ece9f1` |
| Body text | `#230c3a` |
| Muted text / labels | `#6b6577` |
| Placeholder / hint | `#9a94a6` |
| Header subtitle (on dark) | `#b9a9cc` |
| Header links (on dark) | `#cdbfdc`, hover `#ffffff` |

Use the gradient sparingly, as an accent only: the primary button, the thin strip under the header, and the logo mark. Everything else is flat. Do not put the gradient on large surfaces.

## Typography

Use Inter (load from Google Fonts, `fonts.googleapis.com` is allowed), with a system-font fallback stack. Body text weight 400, headings and the Hermes wordmark weight 500 to 600. Base body size 15 to 16px, line height around 1.6. Sentence case everywhere, no all-caps.

## Logo and assets

The JWB logo files are in `Projects/Hermes/brand-assets/` (SVGs in `brand-assets/svg/`, plus PNGs and the colour note). Copy what you use into the app's `public/brand/` folder and reference from there.

- **Header mark (on the dark header):** a small gradient rounded square, 26px, `border-radius: 6px`, `background: linear-gradient(135deg, #4ac8ef, #b3489a)`. This is the safe, guaranteed-legible mark on the dark header and matches the approved mockup. The full JWB icon SVG is in `brand-assets/svg/` if you want to use it instead, but only if it reads cleanly on `#230c3a`, verify before using.
- **Favicon:** use `brand-assets/JWB-square-dark.png` (or generate a small gradient "H"). Set a proper page title and favicon, the browser tab currently just says "Hermes", keep that title.
- **Footer (optional):** the full JWB long logo on light, `brand-assets/JWB-long-dark.png`, shown small and muted.

## Layout, screen by screen

Keep the existing structure. Restyle as follows.

### Header (all screens)
- Full-width bar, background `#230c3a`, padding about 13px 16px.
- Left: the gradient mark, then "Hermes" in white at 18px weight 500, then a thin divider (`1px solid #463159`) and "Just Website Brokerage" at 12px in `#b9a9cc`.
- Right: the existing "Add business" and "Log out" links at 13px in `#cdbfdc`, hover `#ffffff`.
- Directly under the bar, a 3px strip using the brand gradient.

### Page
- Background `#faf9fb`. Center the content in a column, max width about 760px, with comfortable vertical padding.

### The form card
- White background, `1px solid #ece9f1`, `border-radius: 12px`, padding about 20px, subtle and borderless of shadow (no drop shadow).
- Field labels ("Business", "Paste the buyer's questions here") at 13px in `#6b6577`, weight 500, with a little space below.
- The select and textarea: `1px solid #d9d6e0`, `border-radius: 8px`, padding about 10px, 15px text. Placeholder text in `#9a94a6`.
- Focus state on select and textarea: border `#4ac8ef` plus a focus ring `box-shadow: 0 0 0 3px rgba(74,200,239,0.25)`. This is the only shadow used in the app.

### The primary button ("Get answers")
- Background the brand gradient, white text, weight 500, `border-radius: 8px`, padding about 10px 18px, no border.
- Hover: slightly dim (`filter: brightness(0.96)`) and pointer cursor.
- Active: `transform: scale(0.98)`.
- Disabled (no business selected, or the question box is empty): `opacity: 0.45`, `cursor: not-allowed`, no hover effect. Right now the button looks greyed-out and disabled even when usable, fix that so it is clearly clickable when a business is selected and there is text.

### Loading and streaming
- While waiting for the answer, the button shows a small spinner and the label "Answering…" and is disabled.
- Stream the answer into an answer card below the form (same white card style). Render it as preformatted text (`white-space: pre-wrap`) so the numbered questions, the "A)" answers, and the line breaks display exactly as written and copy out cleanly.
- Answer card gets a "Copy answers" button in its top-right: outline style (`1px solid #d9d6e0`, `border-radius: 8px`, text `#230c3a`), and on click it briefly changes to "Copied". Copy as plain text, preserving numbering and line breaks.

### Add business screen and Referred questions screen
- Use the same card, field, button, and focus styling so every screen matches. The save buttons on these screens use the same gradient primary-button style.

## Responsiveness
- On narrow screens (phones), the header may wrap the right-hand links under the wordmark, the card goes full width with side padding, and font sizes hold. Make sure the textarea and answer card are comfortable on mobile.

## Accessibility
- White text on `#230c3a` and the link colours given all pass contrast. Keep the focus ring visible on keyboard navigation. Do not remove focus outlines without replacing them with the ring above.

## Do not change
- The page structure and flow (header, business select, question box, button, answer).
- The answer format produced by the Brain (the "Allow me to go through..." opener, the numbered questions, the "A)" answers).
- Any logic, API calls, Airtable, Drive reading, or the Brain itself.

## How to apply
Put this file in the Hermes repo alongside the other specs, copy `brand-assets/` into the project, then tell Claude Code: "Apply Hermes_Design_Spec.md as a styling-only pass, do not change any behaviour or layout." Check it on desktop and a phone width before deploying.
