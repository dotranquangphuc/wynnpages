# ATELIER CLIENT MANIFEST — MASTER NAILS SKELETON

- **Template:** `nails-atelier` (v1.0 Haute Couture Oil & Gold-Leaf Edition)
- **Slug:** `_templates/nails-atelier`
- **Business Name:** Maison Élan Nail Atelier
- **Suburb & State:** Armadale, VIC
- **Address:** 1048 High Street, Armadale VIC 3143
- **Display Phone:** (03) 9123 4567
- **Client Mobile (SMS Booking):** 0412 345 678
- **Email:** hello@maisonelan.com.au
- **Palette:** `01` — Warm Terracotta & Champagne Gold (`01` | `02` | `03`)
- **Logo Mode:** `monogram` (`monogram` embossed gold wax seal `M` | `image` custom logo URL)
- **Booking Mode:** `modal` (Set `bookingUrl` in `window.ATELIER_CONFIG` to Fresha/Timely/Square URL when client has one, or leave empty to use the built-in Atelier Concierge SMS/Email Booking Dialog)
- **Instagram:** `@maisonelan.nails` (`https://instagram.com`)
- **Facebook:** `https://facebook.com`
- **Parking Note:** Complimentary 2-hour street parking along High St & rear laneway access via Wattletree Rd.

## How to Customize for a Real Client
1. Run `node scripts/atelier-sync.mjs init <slug> --name "Salon Name" --palette 02` (or `pull <slug>` if already live).
2. Edit `window.ATELIER_CONFIG` and `window.SALON_MENU_DATA` inside `clients/<slug>/index.html`.
3. If bespoke artwork is needed, invoke `image-generator` following `clients/GEMINI.md` and save to `clients/<slug>/assets/`.
4. Publish live to `<slug>.wynnpages.com.au` via `node scripts/atelier-sync.mjs push <slug>`.
