# ATELIER CLIENT MANIFEST — CAFE

- **Slug:** `cafe`
- **Live Demo URL:** https://cafe.wynnpages.com.au
- **Official Domain:** Pending
- **Stripe Customer ID:** `cus_VcXRb4aStmdaaN`
- **Selected Haute Couture Palette:** `01` (`01` Terracotta & Gold | `02` Rose Silk & Rose-Gold | `03` Botanical Sage | `04` Espresso Cashmere & Brushed Gold | `05` Coastal Pearl & Mineral Slate)
- **Business Name:** cafe
- **Display Phone:** 0424717777
- **SMS Phone:** 0424717777
- **Email:** dotranquangphuc@gmail.com
- **Address / Suburb:** TBD
- **Social & Booking Links:** None provided yet
- **Client Preferred Colors / Vibe Notes:** Curated Atelier | N/A

## Client Uploaded Brief Assets (`_client_uploads/`)
- No uploaded menu/logo files downloaded yet. Using curated Australian AUD sample menu in `window.SALON_MENU_DATA`.

## Antigravity Editing Rules
1. Always preserve the **WynnPages Digital Atelier** standards in `clients/GEMINI.md` (oil-painting + gold-leaf aesthetic, zero emojis, italic accent heading signature).
2. Update salon details, palette, and real menu pricing inside `<script id="atelier-salon-data">` (`window.ATELIER_CONFIG` & `window.SALON_MENU_DATA`) in `index.html`.
3. Run `node scripts/atelier-sync.mjs push cafe` after editing to publish immediately to `https://cafe.wynnpages.com.au`.
