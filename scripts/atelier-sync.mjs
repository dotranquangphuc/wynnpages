#!/usr/bin/env node
/**
 * WynnPages Digital Atelier — Local <-> Live KV Sync & Initializer CLI
 *
 * Commands:
 *   node scripts/atelier-sync.mjs init <slug> [--palette 01|02|03] [--name "Salon Name"]
 *   node scripts/atelier-sync.mjs pull <slug>
 *   node scripts/atelier-sync.mjs push <slug>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENTS_DIR = path.join(ROOT_DIR, 'clients');
const TEMPLATE_HTML_PATH = path.join(CLIENTS_DIR, '_templates', 'nails-atelier', 'index.html');
const PUBLIC_TEMPLATE_COPY = path.join(ROOT_DIR, 'templates', 'nails-atelier.html');

const STUDIO_ORIGIN = process.env.WYNN_ORIGIN || 'https://wynnpages.com.au';
const ADMIN_KEY = process.env.WYNN_ADMIN_KEY || 'wynn2026';

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseSocialAndBookingLinks(raw) {
  const result = { instagramUrl: '', instagramHandle: '', facebookUrl: '', bookingUrl: '' };
  if (!raw) return result;
  const tokens = String(raw).split(/[\s,|;]+/).map((s) => s.trim()).filter(Boolean);
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (lower.includes('instagram.com/') || lower.startsWith('@')) {
      if (lower.startsWith('@')) {
        result.instagramHandle = t;
        result.instagramUrl = `https://instagram.com/${t.slice(1)}`;
      } else {
        result.instagramUrl = t.startsWith('http') ? t : `https://${t}`;
        const m = result.instagramUrl.match(/instagram\.com\/([^/?#]+)/i);
        if (m && m[1]) result.instagramHandle = `@${m[1]}`;
      }
    } else if (lower.includes('facebook.com/') || lower.includes('fb.com/')) {
      result.facebookUrl = t.startsWith('http') ? t : `https://${t}`;
    } else if (
      lower.includes('fresha.com') ||
      lower.includes('timely') ||
      lower.includes('squareup.com') ||
      lower.includes('square.site') ||
      lower.includes('vagaro.com') ||
      lower.includes('booksy.com') ||
      lower.includes('treatwell') ||
      lower.startsWith('http')
    ) {
      if (!result.bookingUrl) {
        result.bookingUrl = t.startsWith('http') ? t : `https://${t}`;
      }
    }
  }
  return result;
}

function inferAuState(pc) {
  const n = Number(pc);
  if (!pc || Number.isNaN(n)) return '';
  if (pc.startsWith('08') || pc.startsWith('09')) return 'NT';
  if ((n >= 2600 && n <= 2618) || (n >= 2900 && n <= 2920)) return 'ACT';
  if (n >= 2000 && n <= 2999) return 'NSW';
  if (n >= 3000 && n <= 3999) return 'VIC';
  if (n >= 4000 && n <= 4999) return 'QLD';
  if (n >= 5000 && n <= 5799) return 'SA';
  if (n >= 6000 && n <= 6797) return 'WA';
  if (n >= 7000 && n <= 7799) return 'TAS';
  return '';
}

function parseAuAddress(raw) {
  const str = String(raw || '').trim();
  if (!str) return { street: '', streetName: '', suburb: '', state: '', postcode: '' };
  const pcMatch = str.match(/\b(\d{4})\b/);
  const postcode = pcMatch ? pcMatch[1] : '';
  const stMatch = str.match(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/i);
  const state = stMatch ? stMatch[1].toUpperCase() : inferAuState(postcode);

  const cleanedParts = str
    .split(',')
    .map((p) => p
      .replace(/\bAustralia\b/gi, '')
      .replace(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\b/gi, '')
      .replace(/\b\d{4}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    )
    .filter(Boolean);

  let street = '';
  let suburb = '';
  if (cleanedParts.length >= 2) {
    street = cleanedParts[0];
    suburb = cleanedParts[1];
  } else if (cleanedParts.length === 1) {
    const single = cleanedParts[0];
    if (/^\d+|^(shop|suite|unit|level)\b/i.test(single)) {
      street = single;
    } else {
      suburb = single;
    }
  }
  const streetName = street
    .replace(/^(?:shop|suite|unit|level|lvl)\s*[a-z0-9/-]+[,\s/]*/i, '')
    .replace(/^\d+[a-z]?[/-]?\d*\s+/i, '')
    .trim();

  return { street, streetName, suburb, state, postcode };
}

function buildClientFaviconSvg(bizName, palette = '01') {
  const initial = (String(bizName || '').replace(/[^A-Za-z]/g, '').charAt(0) || 'A').toUpperCase();
  const themes = {
    '01': { bg1: '#FCF9F3', bg2: '#F3DFB2', ring: '#D49B28', accent: '#96432B' },
    '02': { bg1: '#FFFDFB', bg2: '#F5DFD4', ring: '#C89378', accent: '#9E5850' },
    '03': { bg1: '#FAFCF8', bg2: '#DCE6DF', ring: '#B59461', accent: '#466052' }
  };
  const t = themes[palette] || themes['01'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="wax" cx="32%" cy="28%" r="72%">
      <stop offset="0%" stop-color="${t.bg1}"/>
      <stop offset="100%" stop-color="${t.bg2}"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#wax)" stroke="${t.ring}" stroke-width="2.2"/>
  <circle cx="32" cy="32" r="25.5" fill="none" stroke="${t.ring}" stroke-width="0.9" stroke-opacity="0.55"/>
  <text x="32" y="42.5" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="700" font-size="31" fill="${t.accent}">${initial}</text>
</svg>\n`;
}

function injectClientIntoMasterHtml(templateHtml, client, paletteOverride) {
  const bizName = (client && (client.businessName || client.name)) || 'Maison Élan';
  const monogram = bizName.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || 'A';
  const palette = paletteOverride || '01';
  const address = (client && client.businessAddress) || 'Melbourne, VIC';
  const parsedAddr = parseAuAddress(address);
  const displayPhone = (client && (client.displayPhone || client.phone)) || '';
  const smsPhone = (client && (client.phone || client.displayPhone)) || '';
  const email = (client && client.email) || '';
  const parsedLinks = parseSocialAndBookingLinks(client && client.socialLinks);

  let html = templateHtml.replace(/data-palette="0[123]"/, `data-palette="${palette}"`);

  const patchStringField = (fieldName, newValue) => {
    if (newValue === undefined || newValue === null) return;
    const escaped = JSON.stringify(String(newValue));
    const re = new RegExp(`(${fieldName}:\\s*)"[^"]*"`);
    html = html.replace(re, `$1${escaped}`);
  };

  patchStringField('palette', palette);
  patchStringField('salonName', bizName);
  patchStringField('monogram', monogram);

  const resolvedSuburb = parsedAddr.suburb || parsedAddr.street || 'Australia';
  const resolvedState = parsedAddr.state || '';
  const shortLoc = [resolvedSuburb, resolvedState].filter(Boolean).join(' ') || 'Australia';

  const safeTitleBiz = bizName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeAttrBiz = safeTitleBiz.replace(/"/g, '&quot;');
  const safeLoc = shortLoc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const seoTitle = `${safeAttrBiz} — Bespoke BIAB &amp; Nail Sanctuary | ${safeLoc}`;
  const seoDesc = `Experience bespoke HEMA-free BIAB overlays, fine-art manicure design, and botanical spa pedicures at ${safeAttrBiz} in ${safeLoc}. Reserve your appointment online.`;

  html = html.replace(
    /<title id="page-meta-title">[\s\S]*?<\/title>/,
    `<title id="page-meta-title">${seoTitle}</title>`
  );
  html = html.replace(
    /<meta name="description"[^>]*>/,
    `<meta name="description" id="page-meta-desc" content="${seoDesc}">`
  );
  html = html.replace(
    /<meta property="og:site_name"[^>]*>/,
    `<meta property="og:site_name" id="og-site-name" content="${safeAttrBiz}">`
  );
  html = html.replace(
    /<meta property="og:title"[^>]*>/,
    `<meta property="og:title" id="og-title" content="${seoTitle}">`
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/,
    `<meta property="og:description" id="og-desc" content="${seoDesc}">`
  );
  html = html.replace(
    /<meta property="og:image:alt"[^>]*>/,
    `<meta property="og:image:alt" id="og-image-alt" content="${safeAttrBiz} — Bespoke Nail Sanctuary">`
  );
  html = html.replace(
    /<meta name="twitter:title"[^>]*>/,
    `<meta name="twitter:title" id="tw-title" content="${seoTitle}">`
  );
  html = html.replace(
    /<meta name="twitter:description"[^>]*>/,
    `<meta name="twitter:description" id="tw-desc" content="${seoDesc}">`
  );

  if (address) {
    patchStringField('address', address);
    patchStringField('mapsQuery', `${address}, Australia`);
    patchStringField('suburb', resolvedSuburb);
    patchStringField('state', resolvedState);
    patchStringField('heroBadge', `${resolvedSuburb} • BIAB & Non-Toxic Nail Sanctuary`);
    const parkingText = parsedAddr.streetName
      ? `Convenient client parking right near ${parsedAddr.streetName} with effortless ground-level boutique arrival.`
      : `Convenient local client parking nearby in ${resolvedSuburb} with effortless boutique arrival.`;
    patchStringField('parkingNote', parkingText);
  }
  if (displayPhone) patchStringField('displayPhone', displayPhone);
  if (smsPhone) patchStringField('smsPhone', smsPhone);
  if (email) patchStringField('email', email);
  if (parsedLinks.bookingUrl) patchStringField('bookingUrl', parsedLinks.bookingUrl);
  if (parsedLinks.instagramUrl) patchStringField('instagramUrl', parsedLinks.instagramUrl);
  if (parsedLinks.instagramHandle) patchStringField('instagramHandle', parsedLinks.instagramHandle);
  if (parsedLinks.facebookUrl) patchStringField('facebookUrl', parsedLinks.facebookUrl);

  const jsonLdObj = {
    '@context': 'https://schema.org',
    '@type': 'NailSalon',
    name: bizName,
    description: `Bespoke BIAB overlays, artisanal nail artistry, and hospital-grade botanical hand & foot care in ${shortLoc}.`,
    image: '/og-share.jpg',
    priceRange: '$$',
    currenciesAccepted: 'AUD',
    telephone: displayPhone || smsPhone || '',
    address: {
      '@type': 'PostalAddress',
      streetAddress: parsedAddr.street || address || '',
      addressLocality: parsedAddr.suburb || '',
      addressRegion: parsedAddr.state || '',
      postalCode: parsedAddr.postcode || '',
      addressCountry: 'AU'
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: '4.9',
      reviewCount: '280'
    }
  };
  const sameAs = [parsedLinks.instagramUrl, parsedLinks.facebookUrl].filter(Boolean);
  if (sameAs.length) jsonLdObj.sameAs = sameAs;
  html = html.replace(
    /<script type="application\/ld\+json" id="salon-jsonld">[\s\S]*?<\/script>/,
    `<script type="application/ld+json" id="salon-jsonld">\n${JSON.stringify(jsonLdObj, null, 2)}\n  </script>`
  );

  return html;
}

function buildManifestMarkdown(slug, client, palette = '01', uploadedFiles = []) {
  const c = client || {};
  const bizName = c.businessName || c.name || slug;
  return [
    `# ATELIER CLIENT MANIFEST — ${bizName.toUpperCase()}`,
    ``,
    `- **Slug:** \`${slug}\``,
    `- **Live Demo URL:** https://${slug}.wynnpages.com.au`,
    `- **Official Domain:** ${c.liveUrl || c.existingDomain || c.desiredDomains || 'Pending'}`,
    `- **Stripe Customer ID:** \`${c.id || 'Local Draft'}\``,
    `- **Selected Haute Couture Palette:** \`${palette}\` (\`01\` Terracotta & Gold | \`02\` Rose Silk & Espresso | \`03\` Botanical Sage)`,
    `- **Business Name:** ${bizName}`,
    `- **Display Phone:** ${c.displayPhone || c.phone || 'TBD'}`,
    `- **SMS Phone:** ${c.phone || 'TBD'}`,
    `- **Email:** ${c.email || 'TBD'}`,
    `- **Address / Suburb:** ${c.businessAddress || 'TBD'}`,
    `- **Social & Booking Links:** ${c.socialLinks || 'None provided yet'}`,
    `- **Client Preferred Colors / Vibe Notes:** ${c.brandColors || 'Curated Atelier'} | ${c.vibeLinks || 'N/A'}`,
    ``,
    `## Client Uploaded Brief Assets (\`_client_uploads/\`)`,
    uploadedFiles.length
      ? uploadedFiles.map((f) => `- **${f.kind}:** \`_client_uploads/${f.name}\` *(Inspect with \`read_file\` to transcribe real menu prices or harmonize logo)*`).join('\n')
      : `- No uploaded menu/logo files downloaded yet. Using curated Australian AUD sample menu in \`window.SALON_MENU_DATA\`.`,
    ``,
    `## Antigravity Editing Rules`,
    `1. Always preserve the **WynnPages Digital Atelier** standards in \`clients/GEMINI.md\` (oil-painting + gold-leaf aesthetic, zero emojis, italic accent heading signature).`,
    `2. Update salon details, palette, and real menu pricing inside \`<script id="atelier-salon-data">\` (\`window.ATELIER_CONFIG\` & \`window.SALON_MENU_DATA\`) in \`index.html\`.`,
    `3. Run \`node scripts/atelier-sync.mjs push ${slug}\` after editing to publish immediately to \`https://${slug}.wynnpages.com.au\`.`
  ].join('\n') + '\n';
}

async function downloadClientBriefUploads(client, clientDir) {
  const downloaded = [];
  if (!client) return downloaded;
  const assets = [
    { kind: 'Menu / Price List', id: client.menuFileId, name: client.menuFileName || 'client-menu.bin' },
    { kind: 'Brand Logo', id: client.logoFileId, name: client.logoFileName || 'client-logo.bin' },
    { kind: 'Salon Photos', id: client.photosFileId, name: client.photosFileName || 'client-photos.bin' }
  ];

  const uploadsDir = path.join(clientDir, '_client_uploads');
  for (const item of assets) {
    if (!item.id || !item.id.startsWith('file_')) continue;
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      const safeName = item.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const url = `${STUDIO_ORIGIN}/api/file?id=${encodeURIComponent(item.id)}&name=${encodeURIComponent(safeName)}&key=${encodeURIComponent(ADMIN_KEY)}`;
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(path.join(uploadsDir, safeName), buf);
        downloaded.push({ kind: item.kind, name: safeName });
      }
    } catch (_) {}
  }
  return downloaded;
}

async function fetchRemoteBundle(slugOrCid) {
  const url = `${STUDIO_ORIGIN}/api/demo-bundle?slug=${encodeURIComponent(slugOrCid)}&key=${encodeURIComponent(ADMIN_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function walkSiteFiles(dir, baseDir = dir, list = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'ATELIER_MANIFEST.md' || entry.name === '_client_uploads' || entry.name === 'node_modules') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSiteFiles(full, baseDir, list);
    } else {
      const rel = '/' + path.relative(baseDir, full).split(path.sep).join('/');
      const isText = /\.(html?|css|m?js|json|svg|txt|xml)$/i.test(entry.name);
      if (isText) {
        list.push({ path: rel, text: fs.readFileSync(full, 'utf8') });
      } else {
        list.push({ path: rel, base64: fs.readFileSync(full).toString('base64') });
      }
    }
  }
  return list;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = (positional[0] || '').toLowerCase();
  const rawTarget = positional[1] || '';

  if (cmd === 'sync-template') {
    fs.mkdirSync(path.dirname(PUBLIC_TEMPLATE_COPY), { recursive: true });
    fs.copyFileSync(TEMPLATE_HTML_PATH, PUBLIC_TEMPLATE_COPY);
    console.log(`Synced master skeleton -> ${PUBLIC_TEMPLATE_COPY}`);
    return;
  }

  if (!cmd || !rawTarget || !['init', 'pull', 'push'].includes(cmd)) {
    console.error('Usage:\n  node scripts/atelier-sync.mjs init <slug> [--palette 01|02|03] [--name "Salon Name"]\n  node scripts/atelier-sync.mjs pull <slug>\n  node scripts/atelier-sync.mjs push <slug>');
    process.exit(1);
  }

  const remote = await fetchRemoteBundle(rawTarget).catch(() => null);
  const client = remote && remote.client ? remote.client : (flags.name ? { businessName: flags.name } : null);
  const slug = slugify((remote && remote.slug) || rawTarget);
  const clientDir = path.join(CLIENTS_DIR, slug);
  fs.mkdirSync(clientDir, { recursive: true });

  if (cmd === 'init') {
    const palette = flags.palette || '01';
    const masterHtml = fs.readFileSync(TEMPLATE_HTML_PATH, 'utf8');
    const hydrated = injectClientIntoMasterHtml(masterHtml, client, palette);
    fs.writeFileSync(path.join(clientDir, 'index.html'), hydrated, 'utf8');
    const bizLabel = (client && (client.businessName || client.name)) || slug;
    fs.writeFileSync(path.join(clientDir, 'favicon.svg'), buildClientFaviconSvg(bizLabel, palette), 'utf8');
    const uploads = await downloadClientBriefUploads(client, clientDir);
    fs.writeFileSync(path.join(clientDir, 'ATELIER_MANIFEST.md'), buildManifestMarkdown(slug, client, palette, uploads), 'utf8');
    console.log(`Initialized clients/${slug}/ with Nails Atelier Skeleton, bespoke favicon.svg & SEO (Palette ${palette}).`);
    return;
  }

  if (cmd === 'pull') {
    const files = (remote && Array.isArray(remote.files)) ? remote.files : [];
    if (files.length > 0) {
      for (const f of files) {
        const cleanRel = f.path.replace(/^\/+/, '');
        const destPath = path.join(clientDir, cleanRel);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        if (f.text !== undefined) {
          fs.writeFileSync(destPath, f.text, 'utf8');
        } else if (f.base64) {
          fs.writeFileSync(destPath, Buffer.from(f.base64, 'base64'));
        }
      }
      console.log(`Pulled ${files.length} live file(s) from KV into clients/${slug}/`);
    } else {
      const palette = flags.palette || '01';
      const masterHtml = fs.readFileSync(TEMPLATE_HTML_PATH, 'utf8');
      const hydrated = injectClientIntoMasterHtml(masterHtml, client, palette);
      fs.writeFileSync(path.join(clientDir, 'index.html'), hydrated, 'utf8');
      const bizLabel = (client && (client.businessName || client.name)) || slug;
      fs.writeFileSync(path.join(clientDir, 'favicon.svg'), buildClientFaviconSvg(bizLabel, palette), 'utf8');
      console.log(`No live KV bundle found yet for "${slug}" — initialized fresh Nails Atelier skeleton + favicon.svg in clients/${slug}/.`);
    }
    const uploads = await downloadClientBriefUploads(client, clientDir);
    if (!fs.existsSync(path.join(clientDir, 'ATELIER_MANIFEST.md')) || uploads.length > 0 || client) {
      fs.writeFileSync(path.join(clientDir, 'ATELIER_MANIFEST.md'), buildManifestMarkdown(slug, client, flags.palette || '01', uploads), 'utf8');
    }
    if (uploads.length) {
      console.log(`Downloaded ${uploads.length} client brief upload(s) into clients/${slug}/_client_uploads/`);
    }
    return;
  }

  if (cmd === 'push') {
    const files = walkSiteFiles(clientDir);
    if (!files.length) {
      console.error(`No publishable files found in clients/${slug}/`);
      process.exit(1);
    }
    const payload = {
      adminKey: ADMIN_KEY,
      customerId: (client && client.id) || flags.cid || '',
      slug,
      files
    };
    const res = await fetch(`${STUDIO_ORIGIN}/api/upload-demo-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      console.error('Upload failed:', data.error || res.statusText);
      process.exit(1);
    }
    console.log(`Published ${files.length} file(s) live -> ${data.demoUrl}`);
  }
}

main();
