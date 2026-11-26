# ATELIER CLIENT MANIFEST — LUX NAIL BAR & CO. SOUTHBANK

- **Slug:** `luxnailbarcosouthbank`
- **Live Demo URL:** https://luxnailbarcosouthbank.wynnpages.com.au
- **Official Domain:** Pending
- **Stripe Customer ID:** `cus_VePkSrepE2QfJD`
- **Selected Haute Couture Palette:** `01` (`01` Terracotta & Gold | `02` Rose Silk & Rose-Gold | `03` Botanical Sage | `04` Espresso Cashmere & Brushed Gold | `05` Coastal Pearl & Mineral Slate)
- **Business Name:** Lux Nails Bar
- **Display Phone:** 0478 679 679
- **SMS Phone:** 0478 679 679
- **Email:** luxsouthpoint@gmail.com
- **Address / Suburb:** Shop 7a/271 Grey St, South Brisbane QLD 4101, Australia
- **Social & Booking Links:** None provided yet
- **Client Preferred Colors / Vibe Notes:** Curated Atelier | N/A

## Client Uploaded Brief Assets (`_client_uploads/`)
- No uploaded menu/logo files downloaded yet. Using curated Australian AUD sample menu in `window.SALON_MENU_DATA`.

## Bespoke Brand Identity & Gold-Leaf Assets
- **Gold-Leaf Calligraphic Logo (`assets/lux-logo.svg`):** Custom 24K gold-leaf 3D vector redraw of the calligraphic `"Lux"` script from the salon's storefront sign, harmonized inside the pearl-gold medallion (`#brand-logo-slot` in Header & Reserve Card seal in `#visit`).
- **Gold-Leaf `"L"` Favicon (`favicon.svg`, `favicon.png`):** Embossed Palette `01` wax seal bearing the custom 24K gold-leaf calligraphic `"L"` matching the storefront script.
- **Bespoke 70% 24K Gold Hero Oil Painting & Living Layers (`assets/client-photo-hero-clean.jpg`, `assets/client-photo-hero-curtain-l.webp`, `assets/client-photo-hero-curtain-r.webp`, `assets/client-photo-hero-client-edge.webp`, `assets/client-photo-hero-flowers.webp`, `assets/client-photo-hero.jpg`):**
  - Custom Palette `01` `896×1200` portrait featuring `"Lux / NAIL BAR & Co."` scaled to **70%** (`~272px` width inside the recessed arch) in radiant warm 24K brushed champagne gold with airy limestone-taupe wall shadows matching the luminous studio aesthetic.
  - **Living Oil Painting Mode (`window.ATELIER_CONFIG.livingHero.enabled: true`):** Renders the clean window/plaster/vase base plate (`client-photo-hero-clean.jpg`) underneath two GPU-composited gently billowing sheer linen curtains (`client-photo-hero-curtain-l.webp`, `22 KB`; `client-photo-hero-curtain-r.webp`, `19 KB`) pinned to their top brass rod, with the seated client foreground edge (`client-photo-hero-client-edge.webp`, `9 KB`) locked cleanly in front of the right curtain and the eucalyptus & wattle bouquet (`client-photo-hero-flowers.webp`, `23 KB`) swaying gently around the vase rim (`85.22% 91.88%`). Zero artificial light overlays, zero overlay buttons, opting into motion strictly under `@media (prefers-reduced-motion: no-preference)`.
  - **Instant Rollback Paths:**
    1. Live A/B Static View: append `?static-hero=1` to URL (`https://luxnailbarcosouthbank.wynnpages.com.au/?static-hero=1`).
    2. Disable Living Motion cleanly: set `window.ATELIER_CONFIG.livingHero.enabled = false` in `index.html` (reverts instantly to the matching static 70%-logo painting `assets/client-photo-hero.jpg`).
    3. Full Git Rollback to pre-Living v2 snapshot: `git checkout 2801758 -- clients/luxnailbarcosouthbank/`.

## Antigravity Editing Rules
1. Always preserve the **WynnPages Digital Atelier** standards in `clients/GEMINI.md` (oil-painting + gold-leaf aesthetic, zero emojis, italic accent heading signature).
2. Update salon details, palette, and real menu pricing inside `<script id="atelier-salon-data">` (`window.ATELIER_CONFIG` & `window.SALON_MENU_DATA`) in `index.html`.
3. Run `node scripts/atelier-sync.mjs push luxnailbarcosouthbank` after editing to publish immediately to `https://luxnailbarcosouthbank.wynnpages.com.au`.
