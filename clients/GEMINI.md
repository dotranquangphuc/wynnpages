# WYNNPAGES BESPOKE ATELIER — CLIENT WEBSITE DESIGN STANDARDS

Every client website inside `clients/` MUST embody the **WynnPages Handcrafted Digital Atelier** philosophy (inspired by `index.html` of WynnPages, *Vogue Living Australia*, and Apple Human Interface Fluidity). Reject rigid corporate grids, harsh 1px grey boxes, and generic AI templates.

## 1. The 5 Exclusive Haute Couture Color Palettes & Matched Oil Vaults (STRICT)
Do NOT allow arbitrary neon or harsh colors, and NEVER use pure black (`#000000`) or sterile white (`#FFFFFF`) for page backgrounds. Every client site must use one of these 5 curated CSS variable palettes — each paired with its own pigment-matched oil-painting & kintsugi gold-leaf vault:

1. **Palette `01` — Warm Terracotta & Champagne Gold** *(Default Signature — `assets/atelier/nails/`)*
   - Canvas: `#F6F1E8` | Card Glass: `rgba(255, 252, 247, 0.86)` | Ink: `#2B251E` | Muted Ink: `#6B5E51`
   - Primary Accent: `#96432B` (Terracotta) | Metallic Foil: `#D49B28` (Champagne Gold) | Pill Tint: `#FBDEB9`
2. **Palette `02` — Rose Silk & Rose-Gold** *(Feminine Couture / BIAB Specialists — `assets/atelier/nails/p02/`)*
   - Canvas: `#FAF4F0` | Card Glass: `rgba(255, 251, 249, 0.88)` | Ink: `#261E1D` | Muted Ink: `#6E5A58`
   - Primary Accent: `#9E5850` (Dusty Rose Satin) | Metallic Foil: `#C89378` (Rose-Gold Foil) | Pill Tint: `#F5DFD4`
3. **Palette `03` — Botanical Sage & Antique Brass** *(Organic Day Spa & Mindful Care — `assets/atelier/nails/p03/`)*
   - Canvas: `#F4F5F0` | Card Glass: `rgba(252, 253, 250, 0.88)` | Ink: `#1E2621` | Muted Ink: `#55645B`
   - Primary Accent: `#466052` (Eucalyptus Sage) | Metallic Foil: `#B59461` (Antique Brass) | Pill Tint: `#DCE6DF`
4. **Palette `04` — Espresso Cashmere & Brushed Gold** *(Architectural Luxury / Toorak & Armadale — `assets/atelier/nails/p04/`)*
   - Canvas: `#F5F0E8` | Card Glass: `rgba(253, 250, 244, 0.88)` | Ink: `#221A15` | Muted Ink: `#645448`
   - Primary Accent: `#5C4033` (Espresso Cashmere) | Metallic Foil: `#C69C47` (Brushed Gold) | Pill Tint: `#EAE0D2`
5. **Palette `05` — Coastal Pearl & Mineral Slate** *(Coastal Sanctuary / Bondi, Byron & Noosa — `assets/atelier/nails/p05/`)*
   - Canvas: `#F3F5F6` | Card Glass: `rgba(251, 253, 254, 0.89)` | Ink: `#1B242B` | Muted Ink: `#53636E`
   - Primary Accent: `#3D5A6C` (Mineral Slate) | Metallic Foil: `#C4A267` (Champagne Brass) | Pill Tint: `#DDE6EC`

## 2. Tactile Surfaces, Typography & Apple Fluid Motion
- **Paper Grain Overlay:** Always include the subtle `.bg-paper-grain` texture across the canvas so scrolling feels like turning cotton-rag art paper.
- **Editorial Typography:**
  - Headings: `Cormorant Garamond` (weights 500–700). **Signature Rule:** In major headings, italicize and accent-color the final 2–3 key words (e.g., ` Sanctuary of <em>Mindful Beauty.</em>`).
  - Body & UI: `Plus Jakarta Sans` with generous tracking and balanced line-height.
- **Zero Mobile Emojis:** NEVER use emojis (`💅`, `✨`, `🚀`, `📞`) inside client websites. Use ultra-clean 1.5px bespoke SVG line icons and embossed gold-leaf seals.
- **Organic Geometry & Motion:**
  - Use fluid radii (`rounded-3xl`, `rounded-[28px]`, `rounded-full` pills) and pearl inset borders (`border-white/90`, soft warm shadows).
  - Apply `.shimmer-btn` + `.apple-spring-btn` on primary booking CTAs, and staggered `.reveal-on-scroll` blur-to-focus reveals.
- **Modern Web Performance & Accessibility:**
  - Add `fetchpriority="high"` (and NEVER `loading="lazy"`) on the Hero LCP image; use `loading="lazy"` on below-the-fold lookbook images.
  - Use native `<dialog closedby="any">` with `showModal()` plus the Safari backdrop light-dismiss fallback for Booking / Lightbox modals.

## 3. Logo Treatment (2-Tier Rule)
- **Tier A — Embossed Gold Wax Monogram Seal (Default / Low-Res Client Logo):** Render the salon's initials inside a circular metallic gold-foil embossed seal with double hairline rings and `Cormorant Garamond` italic monogram.
- **Tier B — Curated Client Logo:** If the client supplies a clean logo, strip harsh white boxes and harmonize it inside a pearl glassmorphic medallion or apply a warm duotone/metallic CSS filter so it never clashes with the palette.

## 4. Structured Editable Price Menu & Social Architecture
- **Editable Menu Data:** Store all service categories, AUD prices, durations, and descriptions inside `window.SALON_MENU_DATA` in `<script id="atelier-menu-data">` so updating a real uploaded client menu only requires updating that JSON object—never rewriting layout HTML.
- **Curated Social Integration:** Never embed slow third-party Instagram/Facebook iframes. Use crisp gold-accented social SVG links in Header/Footer plus a curated 4–6 tile **Atelier Lookbook & Instagram Grid** linking directly to the client's Instagram/Facebook profile.

## 5. Fine-Art Oil & Gold-Leaf Imagery (`image-generator` Formula)
Default to the curated artwork in `https://wynnpages.com.au/assets/atelier/nails/` (or local `assets/`). Whenever bespoke artwork is needed via `image-generator`, enforce this exact prompt style:
> *"A bespoke artisanal fine-art illustration for a luxury Australian [industry] atelier. Style: Rich classical oil painting blended with soft botanical watercolor washes, visible tactile impasto brushstrokes, vintage deckled cotton-paper grain, and kintsugi-inspired delicate gold leaf foil veins. Subject: [specific subject]. Lighting: Soft Australian morning window sunlight, warm champagne, muted terracotta, and metallic gold highlights. Haute editorial Vogue Living Australia aesthetic. No text, no watermarks, no 3D CGI plastic rendering, no cartoon vectors."*

