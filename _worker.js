import {
  STRIPE_SECRET_KEY as STRIPE_SECRET_KEY_FALLBACK,
  CLICKSEND_USERNAME as CLICKSEND_USERNAME_FALLBACK,
  CLICKSEND_API_KEY as CLICKSEND_API_KEY_FALLBACK,
  CLICKSEND_FROM as CLICKSEND_FROM_FALLBACK,
  RESEND_API_KEY as RESEND_API_KEY_FALLBACK,
  RESEND_FROM_EMAIL as RESEND_FROM_EMAIL_FALLBACK,
  ADMIN_KEY as ADMIN_KEY_FALLBACK,
  ADMIN_NOTIFY_EMAIL as ADMIN_NOTIFY_EMAIL_FALLBACK,
  ADMIN_NOTIFY_PHONE as ADMIN_NOTIFY_PHONE_FALLBACK
} from './stripe_key.js';

function isValidStripeSecretKey(val) {
  const s = String(val || '').trim();
  return s.startsWith('sk_') || s.startsWith('rk_');
}

function getConfig(env, overrides = {}) {
  const overrideStripe = isValidStripeSecretKey(overrides.stripeSecretKey) ? String(overrides.stripeSecretKey).trim() : '';
  return {
    stripeSecretKey: overrideStripe || env.STRIPE_SECRET_KEY || STRIPE_SECRET_KEY_FALLBACK || '',
    clicksendUsername: overrides.clicksendUsername || env.CLICKSEND_USERNAME || CLICKSEND_USERNAME_FALLBACK || '',
    clicksendApiKey: overrides.clicksendApiKey || env.CLICKSEND_API_KEY || CLICKSEND_API_KEY_FALLBACK || '',
    clicksendFrom: overrides.clicksendFrom || env.CLICKSEND_FROM || CLICKSEND_FROM_FALLBACK || 'WynnPages',
    resendApiKey: overrides.resendApiKey || env.RESEND_API_KEY || RESEND_API_KEY_FALLBACK || '',
    resendFromEmail: overrides.resendFromEmail || env.RESEND_FROM_EMAIL || RESEND_FROM_EMAIL_FALLBACK || 'WynnPages Atelier <hello@wynnpages.com.au>',
    adminKey: env.ADMIN_KEY || ADMIN_KEY_FALLBACK || 'wynn2026',
    adminNotifyEmail: overrides.adminNotifyEmail || env.ADMIN_NOTIFY_EMAIL || ADMIN_NOTIFY_EMAIL_FALLBACK || '',
    adminNotifyPhone: overrides.adminNotifyPhone || env.ADMIN_NOTIFY_PHONE || ADMIN_NOTIFY_PHONE_FALLBACK || '',
    googleDriveWebhookUrl: overrides.googleDriveWebhookUrl || env.GOOGLE_DRIVE_WEBHOOK_URL || '',
    cfApiToken: overrides.cfApiToken || overrides.cfToken || env.CLOUDFLARE_API_TOKEN || '',
    googlePlacesApiKey: overrides.googlePlacesApiKey || overrides.googlePlacesKey || env.GOOGLE_PLACES_API_KEY || '',
    geminiApiKey: overrides.geminiApiKey || overrides.geminiKey || env.GEMINI_API_KEY || overrides.googlePlacesApiKey || overrides.googlePlacesKey || env.GOOGLE_PLACES_API_KEY || '',
    abn: overrides.abn || env.WYNNPAGES_ABN || ''
  };
}

function verifyAdminAuth(request, env, cfg, body = null) {
  // 1. Check Cloudflare Zero Trust (Access) Identity
  const accessJwt = request.headers.get('cf-access-jwt-assertion') || request.headers.get('cf-access-token');
  const accessEmail = (request.headers.get('cf-access-authenticated-user-email') || '').trim().toLowerCase();

  if (accessJwt || accessEmail) {
    const ownerEmail = (env.ADMIN_NOTIFY_EMAIL || 'dotranquangphuc@gmail.com').trim().toLowerCase();
    if (accessEmail && accessEmail !== ownerEmail && accessEmail !== 'dotranquangphuc@gmail.com') {
      return { ok: false, status: 403, error: 'Forbidden: Unauthorized Zero Trust Identity' };
    }
    return { ok: true, via: 'zero_trust', email: accessEmail || ownerEmail };
  }

  // 2. Fallback to Admin Key Passcode
  try {
    const url = new URL(request.url);
    const providedKey = (body && body.adminKey) || request.headers.get('x-admin-key') || url.searchParams.get('key') || '';
    if (providedKey && cfg && cfg.adminKey && providedKey === cfg.adminKey) {
      return { ok: true, via: 'admin_key' };
    }
  } catch (_) {
    const fallbackKey = (body && body.adminKey) || request.headers.get('x-admin-key') || '';
    if (fallbackKey && cfg && cfg.adminKey && fallbackKey === cfg.adminKey) {
      return { ok: true, via: 'admin_key' };
    }
  }

  return { ok: false, status: 401, error: 'Unauthorized: Missing valid Zero Trust Identity or Admin Passcode' };
}

function isValidAuMobile(rawPhone) {
  const norm = normalizeAuPhone(rawPhone);
  return /^\+614\d{8}$/.test(norm);
}

function normalizeAuPhone(rawPhone) {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/[\s\-().]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('04') && cleaned.length === 10) {
    return '+61' + cleaned.slice(1);
  }
  if (cleaned.startsWith('614') && cleaned.length === 11) {
    return '+' + cleaned;
  }
  if (cleaned.startsWith('4') && cleaned.length === 9) {
    return '+61' + cleaned;
  }
  return cleaned;
}

function toGsmSafeAscii(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (m) => (m === 'đ' ? 'd' : 'D'))
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function sanitizeSmsUrlsForClickSend(str) {
  if (!str) return '';
  let out = String(str);
  // 1. Clean query parameters on any wynnpages.com.au URL so client domains/emails never leak in URL params
  out = out.replace(/https?:\/\/(?:[a-z0-9-]+\.)*wynnpages\.com\.au(?:\/[^\s)]*)?/gi, (fullUrl) => {
    try {
      const u = new URL(fullUrl);
      for (const k of ['domain', 'email', 'ns', 'name']) {
        u.searchParams.delete(k);
      }
      return u.toString();
    } catch (_) {
      return fullUrl;
    }
  });
  // 2. Temporarily tokenize legitimate wynnpages.com.au URLs and bare domains so they are untouched
  const safeTokens = [];
  out = out.replace(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)*wynnpages\.com\.au(?:\/[^\s)]*)?/gi, (match) => {
    const idx = safeTokens.length;
    safeTokens.push(match);
    return `__WYNN_SAFE_URL_${idx}__`;
  });
  // 3. Remove any email addresses
  out = out.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, 'our studio email');
  // 4. Remove any non-wynnpages URLs (http:// or https://...)
  out = out.replace(/https?:\/\/[^\s)]+/gi, 'your domain');
  // 5. Remove any bare client/third-party domain names (e.g. cafe.com.au, salon.com, shop.au) so ClickSend never blocks the SMS
  out = out.replace(/\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:com\.au|net\.au|org\.au|id\.au|asn\.au|edu\.au|gov\.au|au|com|net|org|co|io|biz|info|me|site|online|store|shop|beauty|salon|studio|melbourne|sydney)\b/gi, 'your domain');
  // 6. Restore legitimate wynnpages.com.au URLs
  out = out.replace(/__WYNN_SAFE_URL_(\d+)__/g, (_, idx) => safeTokens[Number(idx)] || '');
  return out;
}

async function sendClickSendSms(toPhone, bodyText, cfg) {
  if (typeof toPhone === 'object' && toPhone !== null) {
    cfg = toPhone.cfg || cfg;
    bodyText = toPhone.message || toPhone.body || bodyText;
    toPhone = toPhone.to || toPhone.phone;
  }
  const formattedTo = normalizeAuPhone(toPhone);
  const safeBody = toGsmSafeAscii(sanitizeSmsUrlsForClickSend(bodyText));
  if (!formattedTo) {
    return { sent: false, reason: 'Missing recipient phone number' };
  }
  if (!cfg.clicksendUsername || !cfg.clicksendApiKey) {
    return { sent: false, reason: 'Chưa có ClickSend Username / API Key (Hãy bấm nút Cấu hình ClickSend trên /admin hoặc thêm vào Cloudflare)' };
  }

  async function attemptSend(fromValue) {
    const auth = btoa(`${cfg.clicksendUsername}:${cfg.clicksendApiKey}`);
    const msgObj = {
      source: 'wynnpages-atelier',
      body: safeBody,
      to: formattedTo
    };
    if (fromValue) {
      msgObj.from = fromValue;
    }

    const res = await fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages: [msgObj] })
    });

    const data = await res.json().catch(() => ({}));
    const firstMsg = data && data.data && Array.isArray(data.data.messages) ? data.data.messages[0] : null;
    const msgStatus = firstMsg ? firstMsg.status : null;
    return { res, data, firstMsg, msgStatus };
  }

  try {
    let { res, data, firstMsg, msgStatus } = await attemptSend(cfg.clicksendFrom);

    // At Australia (ACMA), unapproved alphanumeric Sender IDs return INVALID_SENDER_ID.
    // Automatically retry without 'from' so ClickSend uses its shared Australian number pool!
    if (cfg.clicksendFrom && msgStatus && msgStatus !== 'SUCCESS') {
      const retry = await attemptSend('');
      res = retry.res;
      data = retry.data;
      firstMsg = retry.firstMsg;
      msgStatus = retry.msgStatus;
    }

    if (!res.ok || data.response_code !== 'SUCCESS') {
      return { sent: false, reason: data.response_msg || `ClickSend HTTP ${res.status}`, raw: data };
    }

    if (msgStatus && msgStatus !== 'SUCCESS') {
      return {
        sent: false,
        reason: `ClickSend từ chối gửi: ${msgStatus} (${firstMsg.error_text || 'Kiểm tra số dư hoặc Sender ID trên ClickSend'})`,
        raw: firstMsg
      };
    }

    return {
      sent: true,
      to: formattedTo,
      messageId: firstMsg ? firstMsg.message_id : null,
      status: msgStatus || 'SUCCESS',
      price: firstMsg ? firstMsg.message_price : null
    };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

const WYNN_SYNCED_SETTING_KEYS = [
  'stripeSecretKey',
  'stripeWebhookSecret',
  'clicksendUsername',
  'clicksendApiKey',
  'clicksendFrom',
  'resendApiKey',
  'resendFromEmail',
  'googleDriveWebhookUrl',
  'cfApiToken',
  'googlePlacesApiKey',
  'geminiApiKey',
  'telegramBotToken',
  'telegramChatId',
  'adminIp',
  'adminIpList',
  'abn'
];

function isBotUserAgent(ua = '') {
  return /bot|crawler|spider|facebookexternalhit|Facebot|WhatsApp|TelegramBot|Slackbot|Discordbot|LinkedInBot|Twitterbot|Googlebot|bingbot|Applebot|curl|python|headless|Bytespider|GPTBot|PetalBot/i.test(String(ua || ''));
}

function getRequestClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    (request.headers.get('x-forwarded-for') || '').split(',')[0] ||
    ''
  ).trim();
}

function requestHasAdminCookie(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  return /(?:^|;\s*)wynn_admin=1(?:;|$)/.test(cookieHeader);
}

function parseAdminIpList(rawIp = '', rawList = '') {
  const set = new Set();
  for (const src of [rawIp, rawList]) {
    String(src || '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean).forEach(ip => set.add(ip));
  }
  return Array.from(set);
}

function buildAdminHeaders(baseHeaders = {}) {
  return {
    ...baseHeaders,
    'Set-Cookie': 'wynn_admin=1; Domain=.wynnpages.com.au; Path=/; Max-Age=31536000; SameSite=Lax; Secure'
  };
}

async function captureAdminIp(request, env) {
  const ip = getRequestClientIp(request);
  if (!ip) return '';
  try {
    const { settings } = await loadSyncedRuntime(env);
    const list = parseAdminIpList(settings.adminIp, settings.adminIpList);
    if (list.includes(ip) && settings.adminIp) return ip;
    const merged = [ip, ...list.filter(x => x !== ip)].slice(0, 8);
    const db = getD1(env);
    if (db) {
      // Persist admin IP solely to D1 during GET/read requests — zero KV writes!
      await ensureD1Schema(env);
      const nowIso = new Date().toISOString();
      await db.batch([
        db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
          .bind('adminIp', ip, nowIso),
        db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
          .bind('adminIpList', merged.join(','), nowIso)
      ]).catch(() => {});
    }
  } catch (_) {}
  return ip;
}

function getD1(env) {
  return (env && (env.DB || env.wynnpages_db)) || null;
}

let _d1SchemaPromise = null;
async function ensureD1Schema(env) {
  const db = getD1(env);
  if (!db) return false;
  if (!_d1SchemaPromise) {
    _d1SchemaPromise = (async () => {
      const statements = [
        `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, email TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', business_name TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', demo_slug TEXT NOT NULL DEFAULT '', demo_url TEXT NOT NULL DEFAULT '', live_url TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '', payment_status TEXT NOT NULL DEFAULT 'unpaid', flow_type TEXT NOT NULL DEFAULT 'inbound', view_count INTEGER NOT NULL DEFAULT 0, claim_click_count INTEGER NOT NULL DEFAULT 0, last_viewed_at TEXT NOT NULL DEFAULT '', last_clicked_at TEXT NOT NULL DEFAULT '', last_viewer_device TEXT NOT NULL DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_clients_slug ON clients(demo_slug)`,
        `CREATE INDEX IF NOT EXISTS idx_clients_live_url ON clients(live_url)`,
        `CREATE TABLE IF NOT EXISTS activity_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '🔔', title TEXT NOT NULL, message TEXT NOT NULL, client_name TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL DEFAULT '', timestamp TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_events(timestamp DESC)`,
        `CREATE TABLE IF NOT EXISTS tracking_events (id TEXT PRIMARY KEY, slug TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL DEFAULT '', event_type TEXT NOT NULL, device TEXT NOT NULL DEFAULT 'Desktop', user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_tracking_slug_created ON tracking_events(slug, created_at DESC)`,
        `CREATE TABLE IF NOT EXISTS scheduled_sms (id TEXT PRIMARY KEY, client_id TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL DEFAULT '', to_phone TEXT NOT NULL, body_text TEXT NOT NULL, scheduled_for_utc TEXT NOT NULL, scheduled_for_au TEXT NOT NULL, au_timezone TEXT NOT NULL DEFAULT 'Australia/Sydney', status TEXT NOT NULL DEFAULT 'pending', error_reason TEXT NOT NULL DEFAULT '', sent_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_scheduled_sms_due ON scheduled_sms(status, scheduled_for_utc)`,
        `CREATE TABLE IF NOT EXISTS lead_hunter_leads (id TEXT PRIMARY KEY, place_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT 'other', lead_type TEXT NOT NULL DEFAULT '', imported INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS rate_locks (lock_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS sms_history (id TEXT PRIMARY KEY, client_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'sms', to_phone TEXT NOT NULL DEFAULT '', body_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OK', reason TEXT NOT NULL DEFAULT '', timestamp TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_sms_history_client ON sms_history(client_id, timestamp DESC)`
      ];
      await db.batch(statements.map((sql) => db.prepare(sql)));
      return true;
    })().catch((err) => {
      _d1SchemaPromise = null;
      console.error('[D1 schema]', err);
      return false;
    });
  }
  return _d1SchemaPromise;
}

async function hasD1RateLock(env, lockKey) {
  if (!lockKey) return false;
  const db = getD1(env);
  if (db) {
    await ensureD1Schema(env);
    const row = await db.prepare('SELECT expires_at FROM rate_locks WHERE lock_key = ?').bind(lockKey).first().catch(() => null);
    return Boolean(row && Number(row.expires_at) > Date.now());
  }
  if (env && env.WYNN_KV) {
    return Boolean(await env.WYNN_KV.get(lockKey).catch(() => null));
  }
  return false;
}

async function acquireD1RateLock(env, lockKey, ttlSeconds = 21600) {
  if (!lockKey) return true;
  const db = getD1(env);
  const now = Date.now();
  const expiresAt = now + Math.max(10, Number(ttlSeconds) || 21600) * 1000;
  if (db) {
    await ensureD1Schema(env);
    const row = await db.prepare('SELECT expires_at FROM rate_locks WHERE lock_key = ?').bind(lockKey).first().catch(() => null);
    if (row && Number(row.expires_at) > now) {
      return false; // Already locked
    }
    await db.prepare(
      'INSERT INTO rate_locks (lock_key, expires_at) VALUES (?, ?) ON CONFLICT(lock_key) DO UPDATE SET expires_at = excluded.expires_at'
    ).bind(lockKey, expiresAt).run().catch(() => {});
    return true;
  }
  if (env && env.WYNN_KV) {
    const existing = await env.WYNN_KV.get(lockKey).catch(() => null);
    if (existing) return false;
    await env.WYNN_KV.put(lockKey, new Date(now).toISOString(), { expirationTtl: ttlSeconds }).catch(() => {});
    return true;
  }
  return true;
}

async function syncClientsKvSnapshot(env) {
  if (!env || !env.WYNN_KV) return;
  const db = getD1(env);
  if (!db) return;
  try {
    await ensureD1Schema(env);
    const res = await db.prepare(
      'SELECT id, email, name, business_name, phone, demo_slug, demo_url, live_url, stage, payment_status, flow_type, view_count, claim_click_count, updated_at FROM clients ORDER BY updated_at DESC LIMIT 250'
    ).all().catch(() => null);
    const rows = (res && Array.isArray(res.results)) ? res.results : [];
    const payload = JSON.stringify(rows);
    const prevRow = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('clients_data_hash').first().catch(() => null);
    if (prevRow && prevRow.value === payload) return; // Unchanged — skip KV write
    await env.WYNN_KV.put('CLIENTS_DATA', payload).catch(() => {});
    await db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).bind('clients_data_hash', payload, new Date().toISOString()).run().catch(() => {});
  } catch (_) {}
}

function runInBg(ctx, promise) {
  if (!promise) return;
  const wrapped = Promise.resolve(promise).catch((err) => {
    console.error('[bg-task error]', err && err.message ? err.message : err);
  });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(wrapped);
    return null;
  }
  return wrapped;
}

async function loadSyncedRuntime(env, overrides = {}) {
  const db = getD1(env);
  const d1Settings = {};
  let d1Count = 0;
  if (db) {
    await ensureD1Schema(env);
    const rowsRes = await db.prepare('SELECT key, value FROM settings').all().catch(() => null);
    if (rowsRes && Array.isArray(rowsRes.results)) {
      d1Count = rowsRes.results.length;
      for (const r of rowsRes.results) {
        if (r && r.key) d1Settings[r.key] = String(r.value || '');
      }
    }
  }

  // Only fall back to single-key APP_SETTINGS (or legacy KV keys) when D1 settings table has no keys yet
  let kvCreds = {};
  let kvTg = {};
  if ((!db || d1Count === 0) && env && env.WYNN_KV) {
    const appSettings = await env.WYNN_KV.get('APP_SETTINGS', 'json').catch(() => null);
    if (appSettings && typeof appSettings === 'object') {
      kvCreds = appSettings;
    } else {
      const [legacyCreds, legacyTg] = await Promise.all([
        env.WYNN_KV.get('studio_runtime_creds', 'json').catch(() => null),
        env.WYNN_KV.get('telegram_config', 'json').catch(() => null)
      ]);
      kvCreds = legacyCreds || {};
      kvTg = legacyTg || {};
    }
  }

  const synced = {};
  for (const key of WYNN_SYNCED_SETTING_KEYS) {
    let val = '';
    if (Object.prototype.hasOwnProperty.call(d1Settings, key) && d1Settings[key]) {
      val = d1Settings[key];
    } else if (key === 'telegramBotToken') {
      val = (kvTg && kvTg.botToken) || kvCreds.telegramBotToken || (env && env.TELEGRAM_BOT_TOKEN) || '';
    } else if (key === 'telegramChatId') {
      val = (kvTg && kvTg.chatId) || kvCreds.telegramChatId || (env && env.TELEGRAM_CHAT_ID) || '';
    } else if (kvCreds && kvCreds[key]) {
      val = String(kvCreds[key]);
    }
    synced[key] = val;
  }

  // One-time backfill into D1 when D1 settings table is empty
  if (db && d1Count === 0) {
    const backfillNow = new Date().toISOString();
    const stmts = [];
    for (const key of WYNN_SYNCED_SETTING_KEYS) {
      if (synced[key]) {
        stmts.push(
          db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
            .bind(key, synced[key], backfillNow)
        );
      }
    }
    if (stmts.length) {
      await db.batch(stmts).catch(() => {});
    }
  }

  const mergedOverrides = {};
  for (const key of WYNN_SYNCED_SETTING_KEYS) {
    if (synced[key]) mergedOverrides[key] = synced[key];
  }
  if (overrides && typeof overrides === 'object') {
    for (const [k, v] of Object.entries(overrides)) {
      if (v) mergedOverrides[k] = v;
    }
  }

  const baseCfg = getConfig(env, mergedOverrides);
  const validOverrideStripe = isValidStripeSecretKey(mergedOverrides.stripeSecretKey) ? String(mergedOverrides.stripeSecretKey).trim() : '';
  const cfg = {
    ...baseCfg,
    stripeSecretKey: (validOverrideStripe || baseCfg.stripeSecretKey || '').trim(),
    stripeWebhookSecret: (mergedOverrides.stripeWebhookSecret || (env && env.STRIPE_WEBHOOK_SECRET) || '').trim(),
    clicksendFrom: (mergedOverrides.clicksendFrom || baseCfg.clicksendFrom || '').trim(),
    telegramBotToken: (mergedOverrides.telegramBotToken || (env && env.TELEGRAM_BOT_TOKEN) || '').trim(),
    telegramChatId: (mergedOverrides.telegramChatId || (env && env.TELEGRAM_CHAT_ID) || '').trim(),
    geminiApiKey: (mergedOverrides.geminiApiKey || mergedOverrides.googlePlacesApiKey || baseCfg.geminiApiKey || (env && env.GEMINI_API_KEY) || '').trim(),
    abn: String(mergedOverrides.abn || baseCfg.abn || '').trim(),
    adminIp: String(synced.adminIp || '').trim(),
    adminIpList: parseAdminIpList(synced.adminIp, synced.adminIpList)
  };

  return {
    settings: synced,
    cfg,
    stripeEnvConfigured: Boolean(env && env.STRIPE_SECRET_KEY)
  };
}

async function saveSyncedSettings(env, incoming = {}, opts = {}) {
  const db = getD1(env);
  const nowIso = new Date().toISOString();
  const current = await loadSyncedRuntime(env);
  const next = { ...current.settings };

  let hasChanges = false;
  for (const key of WYNN_SYNCED_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) {
      const val = String(incoming[key] || '').trim();
      if ((val || opts.clearEmpty) && next[key] !== val) {
        next[key] = val;
        hasChanges = true;
      }
    }
  }

  const stripeKeyChanged = Boolean(
    Object.prototype.hasOwnProperty.call(incoming, 'stripeSecretKey') &&
    String(incoming.stripeSecretKey || '').trim() &&
    String(incoming.stripeSecretKey || '').trim() !== String(current.settings.stripeSecretKey || '').trim()
  );
  if (stripeKeyChanged && !incoming.stripeWebhookSecret && current.settings.stripeWebhookSecret) {
    next.stripeWebhookSecret = '';
    incoming.stripeWebhookSecret = '';
    hasChanges = true;
  }

  // Skip all D1 and KV writes when nothing actually changed
  if (!hasChanges) {
    return current.settings;
  }

  if (db) {
    await ensureD1Schema(env);
    const stmts = [];
    for (const key of WYNN_SYNCED_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(incoming, key) && next[key] !== current.settings[key]) {
        stmts.push(
          db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
            .bind(key, String(next[key] || ''), nowIso)
        );
      }
    }
    if (stmts.length) {
      await db.batch(stmts);
    }
  }

  // Persist the entire settings object under ONE single KV key: APP_SETTINGS
  if (env && env.WYNN_KV && opts.skipKv !== true) {
    const kvSettings = {};
    for (const key of WYNN_SYNCED_SETTING_KEYS) {
      if (next[key]) kvSettings[key] = next[key];
    }
    kvSettings.updatedAt = nowIso;
    await env.WYNN_KV.put('APP_SETTINGS', JSON.stringify(kvSettings)).catch(() => {});
  }

  if (stripeKeyChanged && next.stripeSecretKey) {
    await migrateD1ClientsToCurrentStripe(env, next.stripeSecretKey).catch(() => {});
  }

  return next;
}

async function ensureStripeCustomerMigrated(env, idOrSlug, stripeSecretKey) {
  if (!idOrSlug || !stripeSecretKey) return null;
  const raw = String(idOrSlug).trim();
  if (raw.startsWith('cus_')) {
    const checkRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(raw)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
    }).catch(() => null);
    if (checkRes && checkRes.ok) {
      const custObj = await checkRes.json().catch(() => null);
      if (custObj && !custObj.deleted) return custObj;
    }
  }

  const db = getD1(env);
  if (!db) return null;
  await ensureD1Schema(env);
  const cleanSlug = slugifyName(raw.replace(/^cus_[A-Za-z0-9]+$/i, '') || raw);
  let d1Row = await db.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(raw).first().catch(() => null);
  if (!d1Row && cleanSlug) {
    d1Row = await db.prepare('SELECT * FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(cleanSlug).first().catch(() => null);
  }
  if (!d1Row) return null;

  let metaObj = {};
  try { metaObj = JSON.parse(d1Row.metadata_json || '{}'); } catch (_) {}
  const rawMeta = (metaObj && metaObj.metadata && typeof metaObj.metadata === 'object') ? metaObj.metadata : {};
  const slugVal = slugifyName(d1Row.demo_slug || metaObj.demoSlug || d1Row.business_name || d1Row.name || '');

  const existingBySlug = slugVal ? await findCustomerBySlugOrId(slugVal, stripeSecretKey).catch(() => null) : null;
  if (existingBySlug && existingBySlug.id && existingBySlug.id.startsWith('cus_')) {
    if (d1Row.id !== existingBySlug.id) {
      await db.prepare('DELETE FROM clients WHERE id = ?').bind(d1Row.id).run().catch(() => {});
      await upsertD1Client(env, { ...metaObj, ...existingBySlug, id: existingBySlug.id });
    }
    const gRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(existingBySlug.id)}`, {
      headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
    }).catch(() => null);
    if (gRes && gRes.ok) return await gRes.json().catch(() => existingBySlug);
  }

  const cParams = new URLSearchParams();
  const bizName = d1Row.business_name || metaObj.businessName || d1Row.name || metaObj.name || slugVal || 'Boutique';
  const emailVal = d1Row.email || metaObj.email || '';
  const phoneVal = d1Row.phone || metaObj.phone || metaObj.displayPhone || '';
  cParams.append('name', bizName);
  if (emailVal) cParams.append('email', emailVal);
  if (phoneVal) cParams.append('phone', phoneVal);

  const preservedMeta = {
    ...rawMeta,
    business_name: bizName,
    customer_name: d1Row.name || metaObj.name || bizName,
    customer_email: emailVal,
    customer_phone: phoneVal,
    display_phone: metaObj.displayPhone || phoneVal,
    demo_slug: slugVal,
    demo_url: d1Row.demo_url || metaObj.demoUrl || (slugVal ? `https://${slugVal}.wynnpages.com.au` : ''),
    live_url: d1Row.live_url || metaObj.liveUrl || '',
    flow_type: d1Row.flow_type || metaObj.flowType || 'outbound',
    stage: d1Row.stage || metaObj.stage || 'outbound_pitched',
    deal_status: metaObj.dealStatus || rawMeta.deal_status || 'standard',
    deal_expires_at: metaObj.dealExpiresAt || rawMeta.deal_expires_at || '',
    channel_mode: metaObj.channelMode || rawMeta.channel_mode || 'sms',
    demo_view_count: String(Math.max(Number(d1Row.view_count || 0), Number(metaObj.demoViewCount || 0))),
    claim_click_count: String(Math.max(Number(d1Row.claim_click_count || 0), Number(metaObj.claimClickCount || 0)))
  };
  for (const [mk, mv] of Object.entries(preservedMeta)) {
    if (mv !== undefined && mv !== null && String(mv) !== '') {
      cParams.append(`metadata[${mk}]`, String(mv).slice(0, 490));
    }
  }

  const createRes = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: cParams.toString()
  }).catch(() => null);
  if (!createRes || !createRes.ok) return null;

  const newCust = await createRes.json().catch(() => null);
  if (!newCust || !newCust.id) return null;

  const formattedNew = formatCustomerRecord(newCust);
  if (d1Row.id !== newCust.id) {
    await db.prepare('DELETE FROM clients WHERE id = ?').bind(d1Row.id).run().catch(() => {});
  }
  await upsertD1Client(env, {
    ...metaObj,
    ...formattedNew,
    id: newCust.id,
    demoViewCount: Math.max(Number(d1Row.view_count || 0), Number(formattedNew.demoViewCount || 0)),
    claimClickCount: Math.max(Number(d1Row.claim_click_count || 0), Number(formattedNew.claimClickCount || 0))
  });
  return newCust;
}

async function migrateD1ClientsToCurrentStripe(env, stripeSecretKey) {
  const db = getD1(env);
  if (!db || !stripeSecretKey) return;
  await ensureD1Schema(env);
  const res = await db.prepare('SELECT id, demo_slug FROM clients LIMIT 100').all().catch(() => null);
  const rows = (res && Array.isArray(res.results)) ? res.results : [];
  for (const r of rows) {
    if (r && r.id) {
      await ensureStripeCustomerMigrated(env, r.id, stripeSecretKey).catch(() => null);
    }
  }
}

async function upsertD1Client(env, clientObj) {
  const db = getD1(env);
  if (!db || !clientObj) return null;
  await ensureD1Schema(env);

  const cleanSlug = slugifyName(clientObj.demoSlug || clientObj.businessName || clientObj.name || '');
  const id = String(clientObj.id || (cleanSlug ? `local_${cleanSlug}` : '')).trim();
  if (!id) return null;

  const nowIso = new Date().toISOString();
  const viewCount = Number(clientObj.demoViewCount || clientObj.viewCount || 0);
  const clickCount = Number(clientObj.claimClickCount || 0);
  const createdMs = Number(clientObj.created || Date.now());
  const metaJson = JSON.stringify(clientObj).slice(0, 65000);

  await db.prepare(`
    INSERT INTO clients (
      id, email, name, business_name, phone, demo_slug, demo_url, live_url,
      stage, payment_status, flow_type, view_count, claim_click_count,
      last_viewed_at, last_clicked_at, last_viewer_device, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = CASE WHEN excluded.email != '' THEN excluded.email ELSE clients.email END,
      name = CASE WHEN excluded.name != '' THEN excluded.name ELSE clients.name END,
      business_name = CASE WHEN excluded.business_name != '' THEN excluded.business_name ELSE clients.business_name END,
      phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE clients.phone END,
      demo_slug = CASE WHEN excluded.demo_slug != '' THEN excluded.demo_slug ELSE clients.demo_slug END,
      demo_url = CASE WHEN excluded.demo_url != '' THEN excluded.demo_url ELSE clients.demo_url END,
      live_url = excluded.live_url,
      stage = CASE WHEN excluded.stage != '' THEN excluded.stage ELSE clients.stage END,
      payment_status = CASE WHEN excluded.payment_status != '' THEN excluded.payment_status ELSE clients.payment_status END,
      flow_type = CASE WHEN excluded.flow_type != '' THEN excluded.flow_type ELSE clients.flow_type END,
      view_count = MAX(clients.view_count, excluded.view_count),
      claim_click_count = MAX(clients.claim_click_count, excluded.claim_click_count),
      last_viewed_at = CASE WHEN excluded.last_viewed_at != '' THEN excluded.last_viewed_at ELSE clients.last_viewed_at END,
      last_clicked_at = CASE WHEN excluded.last_clicked_at != '' THEN excluded.last_clicked_at ELSE clients.last_clicked_at END,
      last_viewer_device = CASE WHEN excluded.last_viewer_device != '' THEN excluded.last_viewer_device ELSE clients.last_viewer_device END,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).bind(
    id,
    String(clientObj.email || ''),
    String(clientObj.name || ''),
    String(clientObj.businessName || ''),
    String(clientObj.phone || ''),
    cleanSlug,
    String(clientObj.demoUrl || ''),
    String(clientObj.liveUrl || ''),
    String(clientObj.stage || ''),
    String(clientObj.paymentStatus || 'unpaid'),
    String(clientObj.flowType || 'inbound'),
    viewCount,
    clickCount,
    String(clientObj.demoLastViewedAt || ''),
    String(clientObj.demoLastClickedAt || ''),
    String(clientObj.demoViewerDevice || ''),
    metaJson,
    createdMs,
    nowIso
  ).run().catch((err) => {
    console.error('[D1 upsert client]', err);
  });

  return id;
}

async function deleteD1Client(env, clientId, cleanSlug = '') {
  const db = getD1(env);
  if (!db || (!clientId && !cleanSlug)) return;
  await ensureD1Schema(env);
  const stmts = [];
  if (clientId) {
    const cid = String(clientId);
    stmts.push(
      db.prepare('DELETE FROM clients WHERE id = ?').bind(cid),
      db.prepare('DELETE FROM tracking_events WHERE client_id = ?').bind(cid),
      db.prepare('DELETE FROM sms_history WHERE client_id = ?').bind(cid),
      db.prepare('DELETE FROM scheduled_sms WHERE client_id = ?').bind(cid)
    );
  }
  if (cleanSlug) {
    const s = slugifyName(cleanSlug);
    if (s) {
      stmts.push(
        db.prepare('DELETE FROM clients WHERE LOWER(demo_slug) = LOWER(?)').bind(s),
        db.prepare('DELETE FROM tracking_events WHERE LOWER(slug) = LOWER(?)').bind(s),
        db.prepare('DELETE FROM activity_events WHERE LOWER(slug) = LOWER(?)').bind(s),
        db.prepare('DELETE FROM rate_locks WHERE lock_key LIKE ?').bind(`%:${s}%`)
      );
    }
  }
  if (stmts.length) {
    await db.batch(stmts).catch(() => {});
  }
}

async function purgeDemoSiteAssetsFromKv(env, rawSlug, customerId = '') {
  if (!env || !env.WYNN_KV) return 0;
  let deletedCount = 0;
  const cleanSlug = slugifyName(String(rawSlug || '').replace(/\.wynnpages\.com\.au$/i, ''));
  const tasks = [];

  if (cleanSlug) {
    const metaKey = `site_meta:${cleanSlug}`;
    const prevMeta = await env.WYNN_KV.get(metaKey, 'json').catch(() => null);
    const assetKeys = new Set();
    if (prevMeta && Array.isArray(prevMeta.filesList)) {
      for (const p of prevMeta.filesList) {
        assetKeys.add(`site_asset:${cleanSlug}:${p}`);
      }
    }
    try {
      const listed = await env.WYNN_KV.list({ prefix: `site_asset:${cleanSlug}:` });
      if (listed && Array.isArray(listed.keys)) {
        for (const k of listed.keys) {
          if (k && k.name) assetKeys.add(k.name);
        }
      }
    } catch (_) {}

    for (const k of assetKeys) {
      tasks.push(env.WYNN_KV.delete(k).catch(() => {}));
      deletedCount++;
    }
    for (const keyName of [
      `sub_${cleanSlug}`,
      `demo_code:${cleanSlug}`,
      `code_${cleanSlug}`,
      `demo_zip:${cleanSlug}`,
      `demo_views:${cleanSlug}`,
      `demo_notify_lock:${cleanSlug}`,
      metaKey
    ]) {
      tasks.push(env.WYNN_KV.delete(keyName).catch(() => {}));
      deletedCount++;
    }
  }

  if (customerId) {
    const cid = String(customerId).trim();
    tasks.push(
      env.WYNN_KV.delete(`revision_data:${cid}`).catch(() => {}),
      env.WYNN_KV.delete(`sms_history:${cid}`).catch(() => {}),
      env.WYNN_KV.delete(`revision_file:${cid}:menu`).catch(() => {}),
      env.WYNN_KV.delete(`revision_file:${cid}:photos`).catch(() => {})
    );
    try {
      const revFiles = await env.WYNN_KV.list({ prefix: `revision_file:${cid}:` });
      if (revFiles && Array.isArray(revFiles.keys)) {
        for (const k of revFiles.keys) {
          if (k && k.name) tasks.push(env.WYNN_KV.delete(k.name).catch(() => {}));
        }
      }
    } catch (_) {}
  }

  await Promise.all(tasks);
  return deletedCount;
}

async function getD1ClientsIndex(env) {
  const db = getD1(env);
  const byId = new Map();
  const bySlug = new Map();
  if (!db) return { byId, bySlug, rows: [] };
  await ensureD1Schema(env);
  const res = await db.prepare('SELECT * FROM clients ORDER BY updated_at DESC').all().catch(() => null);
  const rows = (res && Array.isArray(res.results)) ? res.results : [];
  for (const row of rows) {
    if (row.id) byId.set(row.id, row);
    if (row.demo_slug) bySlug.set(row.demo_slug.toLowerCase(), row);
  }
  return { byId, bySlug, rows };
}

async function recordD1TrackingEvent(env, { slug = '', clientId = '', eventType = 'demo_view', device = 'Desktop', userAgent = '', businessName = '', knownClient = null }) {
  const db = getD1(env);
  const nowIso = new Date().toISOString();
  const cleanSlug = slugifyName(slug);
  if (!db) {
    return { viewCount: null, claimClickCount: null, lastViewedAt: nowIso, lastClickedAt: nowIso, clientId, slug: cleanSlug };
  }
  await ensureD1Schema(env);

  let targetRow = null;
  if (clientId) {
    targetRow = await db.prepare('SELECT id, demo_slug, view_count, claim_click_count, business_name, name, stage, metadata_json FROM clients WHERE id = ?').bind(String(clientId)).first().catch(() => null);
  }
  if (!targetRow && cleanSlug) {
    targetRow = await db.prepare('SELECT id, demo_slug, view_count, claim_click_count, business_name, name, stage, metadata_json FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(cleanSlug).first().catch(() => null);
  }

  // Never materialize synthetic/ghost rows for deleted or non-existent clients
  if (!targetRow && knownClient && knownClient.id) {
    await upsertD1Client(env, knownClient);
    targetRow = await db.prepare('SELECT id, demo_slug, view_count, claim_click_count, business_name, name, stage, metadata_json FROM clients WHERE id = ?').bind(String(knownClient.id)).first().catch(() => null);
  }
  if (!targetRow) {
    return { notFound: true, clientId: '', slug: cleanSlug, viewCount: 0, claimClickCount: 0 };
  }

  const effectiveId = targetRow.id;
  const resolvedSlug = targetRow.demo_slug || cleanSlug;
  const resolvedBiz = targetRow.business_name || targetRow.name || businessName || resolvedSlug || 'Boutique';

  if (eventType === 'claim_click') {
    await db.prepare(`
      UPDATE clients SET
        claim_click_count = claim_click_count + 1,
        last_clicked_at = ?,
        last_viewer_device = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(nowIso, device, nowIso, effectiveId).run();
  } else {
    await db.prepare(`
      UPDATE clients SET
        view_count = view_count + 1,
        last_viewed_at = ?,
        last_viewer_device = ?,
        updated_at = ?
      WHERE id = ?
    `).bind(nowIso, device, nowIso, effectiveId).run();
  }

  await db.prepare(`
    INSERT INTO tracking_events (id, slug, client_id, event_type, device, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `trk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    resolvedSlug,
    effectiveId,
    eventType,
    device,
    String(userAgent || '').slice(0, 240),
    nowIso
  ).run().catch(() => {});

  const updated = await db.prepare('SELECT id, view_count, claim_click_count, last_viewed_at, last_clicked_at FROM clients WHERE id = ?').bind(effectiveId).first().catch(() => null);
  return {
    clientId: effectiveId,
    slug: resolvedSlug,
    businessName: resolvedBiz,
    viewCount: Number((updated && updated.view_count) || 1),
    claimClickCount: Number((updated && updated.claim_click_count) || (eventType === 'claim_click' ? 1 : 0)),
    lastViewedAt: (updated && updated.last_viewed_at) || nowIso,
    lastClickedAt: (updated && updated.last_clicked_at) || nowIso,
    device
  };
}

async function verifyStripeWebhookSig(rawBody, sigHeader, secret) {
  if (!secret) return true;
  if (!sigHeader || typeof sigHeader !== 'string') return false;
  const parts = {};
  for (const item of sigHeader.split(',')) {
    const [k, v] = item.split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }
  const ts = Number(parts.t || 0);
  const v1 = parts.v1 || '';
  if (!ts || !v1 || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${rawBody}`));
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diff === 0;
}

const AU_TIMEZONE = 'Australia/Sydney';

function formatAuDateTime(dateInput = new Date(), timeZone = AU_TIMEZONE) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  if (typeof Temporal !== 'undefined' && Temporal.Instant) {
    try {
      const zdt = Temporal.Instant.from(d.toISOString()).toZonedDateTimeISO(timeZone);
      return `${zdt.toPlainDateTime().toString().slice(0, 19).replace('T', ' ')} (${zdt.offset})`;
    } catch (_) {}
  }
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).format(d);
}

function auWallTimeToUtcIso(wallInput, timeZone = AU_TIMEZONE) {
  const raw = String(wallInput || '').trim();
  if (!raw) return '';
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }
  const norm = raw.replace(' ', 'T');
  const m = norm.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] || 9);
  const minute = Number(m[5] || 0);
  const second = Number(m[6] || 0);

  if (typeof Temporal !== 'undefined' && Temporal.ZonedDateTime) {
    try {
      const zdt = Temporal.ZonedDateTime.from({
        timeZone,
        year,
        month,
        day,
        hour,
        minute,
        second
      });
      return new Date(Number(zdt.epochMilliseconds)).toISOString();
    } catch (_) {}
  }

  // Deterministic iterative offset solver using Intl for AEST (+10) / AEDT (+11)
  const targetUtcAsWall = Date.UTC(year, month - 1, day, hour, minute, second);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  let guess = targetUtcAsWall - 10 * 3600 * 1000;
  for (let i = 0; i < 3; i++) {
    const parts = {};
    for (const p of dtf.formatToParts(new Date(guess))) {
      if (p.type !== 'literal') parts[p.type] = Number(p.value);
    }
    const wallAtGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const diff = targetUtcAsWall - wallAtGuess;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

async function cancelPendingScheduledSmsForCustomer(env, customerId, phone = '') {
  if (!env || (!customerId && !phone)) return 0;
  let cancelledCount = 0;
  const db = getD1(env);
  if (db) {
    await ensureD1Schema(env);
    if (customerId) {
      const r1 = await db.prepare(
        `DELETE FROM scheduled_sms WHERE client_id = ? AND status = 'pending'`
      ).bind(String(customerId)).run().catch(() => null);
      if (r1 && r1.meta && r1.meta.changes) cancelledCount += r1.meta.changes;
    }
    if (phone) {
      const cleanPh = normalizeAuPhone(phone) || String(phone).trim();
      if (cleanPh) {
        const r2 = await db.prepare(
          `DELETE FROM scheduled_sms WHERE to_phone = ? AND status = 'pending'`
        ).bind(cleanPh).run().catch(() => null);
        if (r2 && r2.meta && r2.meta.changes) cancelledCount += r2.meta.changes;
      }
    }
  }
  return cancelledCount;
}

async function processDueScheduledSms(env, ctx) {
  const db = getD1(env);
  const nowUtcIso = new Date().toISOString();
  const currentAuTime = formatAuDateTime(new Date(), AU_TIMEZONE);
  if (!db) {
    return { ok: false, error: 'D1 database binding missing', currentAuTime, nowUtcIso, processed: 0, sentCount: 0, failedCount: 0, items: [] };
  }
  await ensureD1Schema(env);
  const { cfg } = await loadSyncedRuntime(env);

  const dueRes = await db.prepare(
    `SELECT * FROM scheduled_sms WHERE status = 'pending' AND scheduled_for_utc <= ? ORDER BY scheduled_for_utc ASC LIMIT 25`
  ).bind(nowUtcIso).all().catch(() => null);
  const dueRows = (dueRes && Array.isArray(dueRes.results)) ? dueRes.results : [];

  let sentCount = 0;
  let failedCount = 0;
  const items = [];

  for (const row of dueRows) {
    // Atomic claim prevents duplicate sends across concurrent invocations
    const claim = await db.prepare(
      `UPDATE scheduled_sms SET status = 'sending' WHERE id = ? AND status = 'pending'`
    ).bind(row.id).run().catch(() => null);
    if (!claim || !claim.meta || claim.meta.changes !== 1) {
      continue;
    }

    // AUTO-STOP SAFETY: Never send scheduled follow-up/expiry SMS if client has already paid!
    if (row.client_id) {
      let alreadyPaid = false;
      const d1Client = await db.prepare(
        `SELECT payment_status, stage FROM clients WHERE id = ?`
      ).bind(String(row.client_id)).first().catch(() => null);
      if (d1Client && (d1Client.payment_status === 'paid' || d1Client.stage === 'outbound_paid' || d1Client.stage === 'launched')) {
        alreadyPaid = true;
      } else if (cfg.stripeSecretKey && String(row.client_id).startsWith('cus_')) {
        const sRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(row.client_id)}`, {
          headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
        }).catch(() => null);
        if (sRes && sRes.ok) {
          const sCust = formatCustomerRecord(await sRes.json());
          if (sCust && (sCust.paymentStatus === 'paid' || sCust.stage === 'outbound_paid' || sCust.stage === 'launched')) {
            alreadyPaid = true;
          }
        }
      }
      if (alreadyPaid) {
        await db.prepare(`DELETE FROM scheduled_sms WHERE id = ?`).bind(row.id).run().catch(() => {});
        items.push({ id: row.id, status: 'cancelled_paid', to: row.to_phone, reason: 'Auto-stopped: Client already paid' });
        continue;
      }
    }

    const smsRes = await sendClickSendSms({
      to: row.to_phone,
      message: row.body_text,
      cfg
    });
    const sentAtIso = new Date().toISOString();
    let schedClient = { businessName: row.client_name || 'Khách hàng', phone: row.to_phone, id: row.client_id || '' };
    if (row.client_id) {
      const cRow = await db.prepare('SELECT business_name, demo_slug, demo_url, email, view_count FROM clients WHERE id = ?').bind(row.client_id).first().catch(() => null);
      if (cRow) {
        schedClient = {
          id: row.client_id,
          businessName: cRow.business_name || schedClient.businessName,
          demoSlug: cRow.demo_slug || '',
          demoUrl: cRow.demo_url || '',
          email: cRow.email || '',
          phone: row.to_phone
        };
        schedClient._views = Number(cRow.view_count || 0);
      }
    }
    if (smsRes && smsRes.sent) {
      sentCount++;
      await db.prepare(
        `UPDATE scheduled_sms SET status = 'sent', sent_at = ?, error_reason = '' WHERE id = ?`
      ).bind(sentAtIso, row.id).run().catch(() => {});
      if (row.client_id) {
        const histPromise = recordSmsHistory({
          customerId: row.client_id,
          env,
          stripeSecretKey: cfg.stripeSecretKey,
          type: 'scheduled_sms',
          to: row.to_phone,
          text: row.body_text,
          status: true,
          reason: ''
        });
        runInBg(ctx, histPromise);
      }
      await notifyTelegramAutomatedComms({
        env,
        ctx,
        client: schedClient,
        triggerType: 'scheduled_sms_sent',
        icon: '⏰',
        title: `⏰ [SMS HẸN GIỜ] Đã tự động gửi SMS tới ${schedClient.businessName}`,
        views: schedClient._views ?? null,
        smsSent: true,
        smsTo: smsRes.to || row.to_phone,
        smsText: row.body_text,
        extraNote: row.scheduled_for_au ? `Lịch Úc: ${row.scheduled_for_au}` : ''
      });
      items.push({ id: row.id, status: 'sent', to: smsRes.to || row.to_phone, scheduledForAu: row.scheduled_for_au, sentAt: sentAtIso });
    } else {
      failedCount++;
      const reason = (smsRes && smsRes.reason) || 'Send failed';
      await db.prepare(
        `UPDATE scheduled_sms SET status = 'failed', error_reason = ? WHERE id = ?`
      ).bind(String(reason).slice(0, 480), row.id).run().catch(() => {});
      await notifyTelegramAutomatedComms({
        env,
        ctx,
        client: schedClient,
        triggerType: 'scheduled_sms_failed',
        icon: '⚠️',
        title: `⚠️ [SMS HẸN GIỜ LỖI] Không gửi được tới ${schedClient.businessName}`,
        views: schedClient._views ?? null,
        smsSent: false,
        smsSkippedReason: reason,
        smsTo: row.to_phone,
        smsText: row.body_text,
        extraNote: row.scheduled_for_au ? `Lịch Úc: ${row.scheduled_for_au}` : ''
      });
      items.push({ id: row.id, status: 'failed', to: row.to_phone, reason });
    }
  }

  return {
    ok: true,
    timezone: AU_TIMEZONE,
    currentAuTime,
    nowUtcIso,
    processed: items.length,
    sentCount,
    failedCount,
    items
  };
}

async function mirrorLeadHunterToD1(env, leads = []) {
  const db = getD1(env);
  if (!db || !Array.isArray(leads)) return;
  await ensureD1Schema(env);
  const nowIso = new Date().toISOString();
  await db.prepare('DELETE FROM lead_hunter_leads').run().catch(() => {});
  const chunkSize = 40;
  for (let i = 0; i < leads.length; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize);
    const stmts = chunk.map((l, idx) => {
      const id = String(l.placeId || l.id || `lead_${i + idx}_${slugifyName(l.name || 'shop')}`);
      return db.prepare(`
        INSERT INTO lead_hunter_leads (id, place_id, name, industry, lead_type, imported, data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          imported = excluded.imported,
          data_json = excluded.data_json,
          updated_at = excluded.updated_at
      `).bind(
        id,
        String(l.placeId || ''),
        String(l.name || ''),
        String(l.industry || 'other'),
        String(l.leadType || ''),
        l.imported ? 1 : 0,
        JSON.stringify(l).slice(0, 32000),
        nowIso
      );
    });
    if (stmts.length) await db.batch(stmts).catch(() => {});
  }
}

// Persist full SMS message history in D1/KV + sync latest status with Stripe metadata
async function recordSmsHistory({ customerId, env, stripeSecretKey, type, to, text, status, reason, smsResult }) {
  if (!customerId) return null;
  const nowIso = new Date().toISOString();
  const effectiveStatus = status !== undefined ? status : (smsResult && smsResult.sent);
  const effectiveReason = reason !== undefined ? reason : ((smsResult && smsResult.reason) || '');
  const entry = {
    id: 'sms_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: nowIso,
    type: type || 'sms',
    to: to || '',
    text: text || '',
    status: effectiveStatus === true || effectiveStatus === 'OK' || effectiveStatus === 'sent' ? 'OK' : 'ERR',
    reason: effectiveReason || ''
  };

  let totalCount = 1;
  const db = getD1(env);
  if (db) {
    await ensureD1Schema(env);
    await db.prepare(
      `INSERT INTO sms_history (id, client_id, type, to_phone, body_text, status, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      entry.id,
      String(customerId),
      entry.type,
      entry.to,
      entry.text,
      entry.status,
      entry.reason,
      entry.timestamp
    ).run().catch(() => {});
    const cntRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM sms_history WHERE client_id = ?`
    ).bind(String(customerId)).first().catch(() => null);
    if (cntRow && cntRow.cnt) totalCount = Number(cntRow.cnt);
  } else if (env && env.WYNN_KV) {
    const kvKey = `sms_history:${customerId}`;
    const raw = await env.WYNN_KV.get(kvKey, 'json').catch(() => null);
    let list = Array.isArray(raw) ? raw : [];
    list.push(entry);
    if (list.length > 50) list = list.slice(-50);
    totalCount = list.length;
    await env.WYNN_KV.put(kvKey, JSON.stringify(list)).catch(() => {});
  }

  // Update Stripe metadata last_sms_log (capped at 480 chars for Stripe 500-char limit)
  if (stripeSecretKey) {
    const summary = entry.status === 'OK'
      ? `OK (${entry.to || ''}) [${entry.type}] @ ${nowIso}`
      : `ERR: ${entry.reason || 'Failed'} [${entry.type}] @ ${nowIso}`;
    const uP = new URLSearchParams();
    uP.append('metadata[last_sms_log]', summary.slice(0, 480));
    await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: uP.toString()
    }).catch(() => {});
  }

  return { entry, totalCount };
}

function buildAtelierEmailHtml({ preheader, heading, bodyHtml, primaryCta, secondaryCta }) {
  const primaryBtn = primaryCta
    ? `<div style="margin-top:24px;margin-bottom:12px;">
         <a href="${primaryCta.url}" style="display:inline-block;background-color:#96432b;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:14px;">
           ${primaryCta.label} &rarr;
         </a>
       </div>`
    : '';

  const secondaryBtn = secondaryCta
    ? `<div style="margin-top:12px;">
         <a href="${secondaryCta.url}" style="display:inline-block;background-color:#f6f1e8;color:#231f1a;border:1px solid #d8ccb8;font-weight:600;font-size:13px;text-decoration:none;padding:11px 22px;border-radius:12px;">
           ${secondaryCta.label}
         </a>
       </div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:#f6f1e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#231f1a;">
  <div style="max-width:580px;margin:0 auto;padding:36px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#231f1a;letter-spacing:-0.02em;">WynnPages</span>
      <span style="display:inline-block;margin-left:8px;background-color:#fbdeb9;color:#96432b;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;padding:3px 9px;border-radius:99px;vertical-align:middle;">Atelier Studio</span>
    </div>
    <div style="background-color:#ffffff;border:1px solid #e5dec9;border-radius:24px;padding:36px 32px;box-shadow:0 8px 24px rgba(35,31,26,0.05);">
      ${preheader ? `<div style="display:inline-block;background-color:#d4e4ce;color:#4c6b47;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;padding:4px 10px;border-radius:99px;margin-bottom:14px;">${preheader}</div>` : ''}
      <h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.2;color:#231f1a;margin:0 0 16px 0;">${heading}</h1>
      <div style="font-size:15px;line-height:1.65;color:#4a433b;">
        ${bodyHtml}
      </div>
      ${primaryBtn}
      ${secondaryBtn}
    </div>
    <div style="text-align:center;margin-top:24px;font-size:12px;color:#8c8275;">
      WynnPages Australia &bull; Hand-crafted bespoke digital craftsmanship &bull; <a href="https://wynnpages.com.au" style="color:#96432b;text-decoration:none;">wynnpages.com.au</a>
    </div>
  </div>
</body>
</html>`;
}

async function sendResendEmail({ to, subject, html, cfg }) {
  if (!to || !to.includes('@')) {
    return { sent: false, reason: 'Missing valid recipient email' };
  }
  if (!cfg.resendApiKey) {
    return { sent: false, reason: 'Resend API Key (RESEND_API_KEY) not configured' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: cfg.resendFromEmail,
        to: [to],
        subject,
        html
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { sent: false, reason: data.message || `Resend HTTP ${res.status}`, raw: data };
    }
    return { sent: true, id: data.id, to };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

function escapeEmailHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTaxInvoiceEmailHtml({
  businessName = '',
  customerName = '',
  customerEmail = '',
  customerPhone = '',
  amountAud = '$599.00 AUD',
  invoiceNumber = '',
  paidAtAu = '',
  invoiceUrl = '',
  portalUrl = '',
  portalLabel = '',
  abn = '',
  isOutbound = false
}) {
  const displayBiz = businessName || customerName || 'Valued Client';
  const greetingName = (customerName || displayBiz).split(' ')[0] || 'there';
  const stepTitle = isOutbound ? 'Submit Your 1-Round Revision Form' : 'Complete Your Onboarding Brief';
  const introCopy = isOutbound
    ? `Thank you for choosing <strong>WynnPages Studio</strong>! Your payment of <strong>${escapeEmailHtml(amountAud)}</strong> is confirmed and your bespoke website for <strong>${escapeEmailHtml(displayBiz)}</strong> is officially yours.`
    : `Welcome to <strong>WynnPages Studio</strong>! Your payment of <strong>${escapeEmailHtml(amountAud)}</strong> is confirmed and your 7-day bespoke build slot for <strong>${escapeEmailHtml(displayBiz)}</strong> is officially locked in.`;
  const nextStepCopy = isOutbound
    ? `Use your interactive <strong>1-Round Revision Portal</strong> below to confirm your trading hours, phone number, menu pricing, or photos so we can launch your site cleanly within 24–48 hours. Need more time? You can click <strong>Save Draft (Finish Later)</strong> inside the form at any time and return via this same link.`
    : `Please complete your quick 2-minute <strong>Onboarding Brief</strong> using the button below so our design engineers can begin crafting your website right away. Need more time to gather your logo or menu? Click <strong>Save Draft (Finish Later)</strong> inside the form and resume whenever you are ready.`;

  const bodyHtml = `
    <p>G'day ${escapeEmailHtml(greetingName)},</p>
    <p>${introCopy}</p>
    <div style="background-color:#fdf8f3;border:2px solid #96432b;border-radius:16px;padding:18px 20px;margin:20px 0;">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#96432b;margin-bottom:6px;">Action Required • Next Step</div>
      <div style="font-size:15px;font-weight:700;color:#231f1a;margin-bottom:8px;">${escapeEmailHtml(stepTitle)}</div>
      <div style="font-size:13.5px;line-height:1.6;color:#4a433b;margin-bottom:14px;">${nextStepCopy}</div>
      <a href="${escapeEmailHtml(portalUrl)}" style="display:inline-block;background-color:#96432b;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:13px 24px;border-radius:12px;">
        ${escapeEmailHtml(portalLabel || stepTitle)} &rarr;
      </a>
    </div>
    <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:16px;padding:18px 20px;margin:20px 0;font-size:13px;line-height:1.65;color:#3d3730;">
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top;padding-bottom:12px;border-bottom:1px solid #e5dec9;">
            <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#786f64;">Tax Invoice / Payment Receipt</div>
            <div style="font-size:16px;font-weight:700;color:#231f1a;margin-top:2px;">WynnPages Studio (Australia)</div>
            ${abn ? `<div style="font-size:12px;color:#6f665c;">ABN: ${escapeEmailHtml(abn)}</div>` : ''}
          </td>
          <td style="vertical-align:top;text-align:right;padding-bottom:12px;border-bottom:1px solid #e5dec9;">
            <span style="display:inline-block;background-color:#d4e4ce;color:#2f442c;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;padding:4px 10px;border-radius:99px;">Paid in Full</span>
            ${invoiceNumber ? `<div style="font-family:monospace;font-size:12px;color:#574f46;margin-top:6px;">#${escapeEmailHtml(invoiceNumber)}</div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding-top:12px;vertical-align:top;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#8c8275;">Billed To</div>
            <div style="font-weight:700;color:#231f1a;">${escapeEmailHtml(displayBiz)}</div>
            ${customerEmail ? `<div style="color:#574f46;">${escapeEmailHtml(customerEmail)}</div>` : ''}
            ${customerPhone ? `<div style="color:#574f46;">${escapeEmailHtml(customerPhone)}</div>` : ''}
          </td>
          <td style="padding-top:12px;vertical-align:top;text-align:right;">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#8c8275;">Date Issued (AU)</div>
            <div style="font-weight:600;color:#231f1a;">${escapeEmailHtml(paidAtAu)}</div>
          </td>
        </tr>
      </table>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:14px;border-top:1px solid #e5dec9;">
        <tr>
          <td style="padding:10px 0 4px 0;color:#231f1a;font-weight:600;">Bespoke Website Design &amp; Build Package (100% Ownership)</td>
          <td style="padding:10px 0 4px 0;text-align:right;font-weight:700;color:#231f1a;">${escapeEmailHtml(amountAud)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#786f64;font-size:12px;">Zero monthly studio retainers &bull; Hosted on WynnPages Studio Australian High-Speed Network</td>
          <td style="padding:4px 0;text-align:right;color:#4c6b47;font-size:12px;font-weight:700;">Paid</td>
        </tr>
      </table>
      ${invoiceUrl ? `
        <div style="margin-top:14px;padding-top:12px;border-top:1px dashed #d8ccb8;">
          <a href="${escapeEmailHtml(invoiceUrl)}" style="display:inline-block;background-color:#ffffff;color:#231f1a;border:1px solid #d8ccb8;font-weight:700;font-size:12px;text-decoration:none;padding:9px 16px;border-radius:10px;">
            &#128196; Download Official PDF Tax Invoice / Receipt &rarr;
          </a>
        </div>
      ` : ''}
    </div>
    <p style="font-size:13px;color:#6f665c;">Need a hand at any stage? Reply to this email or write to <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a>.</p>
  `;

  return buildAtelierEmailHtml({
    preheader: 'Official Tax Invoice & Next Step Portal Inside',
    heading: `Payment Confirmed for ${escapeEmailHtml(displayBiz)}.`,
    bodyHtml,
    secondaryCta: {
      label: 'Save Link or Visit WynnPages Studio',
      url: portalUrl
    }
  });
}

async function fetchExpandedCheckoutSession(sessionId, stripeSecretKey) {
  if (!sessionId || !stripeSecretKey) return null;
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=invoice&expand[]=payment_intent`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
      }
    );
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (_) {
    return null;
  }
}

async function retrieveStripeInvoiceUrls(sessionData, stripeSecretKey) {
  let invoiceUrl = '';
  let invoicePdf = '';
  let invoiceNumber = '';
  if (!sessionData) return { invoiceUrl, invoicePdf, invoiceNumber };

  const invObj = (sessionData.invoice && typeof sessionData.invoice === 'object') ? sessionData.invoice : null;
  if (invObj) {
    invoiceUrl = invObj.hosted_invoice_url || '';
    invoicePdf = invObj.invoice_pdf || '';
    invoiceNumber = invObj.number || '';
  } else if (typeof sessionData.invoice === 'string' && sessionData.invoice && stripeSecretKey) {
    try {
      const iRes = await fetch(`https://api.stripe.com/v1/invoices/${encodeURIComponent(sessionData.invoice)}`, {
        headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
      });
      if (iRes.ok) {
        const fetchedInv = await iRes.json().catch(() => null);
        if (fetchedInv) {
          invoiceUrl = fetchedInv.hosted_invoice_url || '';
          invoicePdf = fetchedInv.invoice_pdf || '';
          invoiceNumber = fetchedInv.number || '';
        }
      }
    } catch (_) {}
  }

  // Fallback to Stripe Charge receipt_url if invoice object was not generated
  if (!invoiceUrl && sessionData.payment_intent && typeof sessionData.payment_intent === 'object' && sessionData.payment_intent.latest_charge) {
    const chgId = typeof sessionData.payment_intent.latest_charge === 'string'
      ? sessionData.payment_intent.latest_charge
      : (sessionData.payment_intent.latest_charge.id || '');
    if (typeof sessionData.payment_intent.latest_charge === 'object' && sessionData.payment_intent.latest_charge.receipt_url) {
      invoiceUrl = sessionData.payment_intent.latest_charge.receipt_url;
    } else if (chgId && stripeSecretKey) {
      try {
        const chRes = await fetch(`https://api.stripe.com/v1/charges/${encodeURIComponent(chgId)}`, {
          headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
        });
        if (chRes.ok) {
          const chData = await chRes.json().catch(() => null);
          if (chData && chData.receipt_url) invoiceUrl = chData.receipt_url;
        }
      } catch (_) {}
    }
  }

  if (!invoiceNumber && sessionData.id) {
    invoiceNumber = 'WP-' + String(sessionData.id).slice(-8).toUpperCase();
  }
  return { invoiceUrl, invoicePdf, invoiceNumber };
}

async function finalizeStripePaymentAndNotify({ sessionId = '', sessionObj = null, origin = 'https://wynnpages.com.au', env, ctx, cfg }) {
  const sid = String(sessionId || (sessionObj && sessionObj.id) || '').trim();
  if (!sid || !sid.startsWith('cs_')) {
    return { ok: false, paid: false, reason: 'Invalid session ID' };
  }

  let sessionData = await fetchExpandedCheckoutSession(sid, cfg.stripeSecretKey);
  if (!sessionData) sessionData = sessionObj;
  if (!sessionData) {
    return { ok: false, paid: false, reason: 'Checkout session not found' };
  }

  const isPaid = sessionData.payment_status === 'paid' || sessionData.status === 'complete';
  const meta = sessionData.metadata || {};
  const cd = sessionData.customer_details || {};
  const email = (cd.email || sessionData.customer_email || meta.customer_email || '').trim();
  const name = (meta.customer_name || cd.name || '').trim();
  const phone = (cd.phone || meta.customer_phone || '').trim();

  if (!isPaid) {
    return { ok: true, paid: false, sessionId: sid, email, name, phone };
  }

  const flowTypeRaw = meta.flow_type || (meta.flow === 'outbound_demo' ? 'outbound' : 'inbound');
  const customerIdHint = (typeof sessionData.customer === 'string' && sessionData.customer)
    || sessionData.client_reference_id
    || meta.customer_id
    || '';

  let cust = null;
  if (customerIdHint && cfg.stripeSecretKey) {
    const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerIdHint)}`, {
      headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
    }).catch(() => null);
    if (cRes && cRes.ok) cust = await cRes.json().catch(() => null);
  }
  if (!cust && email && cfg.stripeSecretKey) {
    cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
  }

  // Create Stripe customer record if Checkout used customer_email without an existing customer
  if (!cust && cfg.stripeSecretKey && (email || name || phone)) {
    const createP = new URLSearchParams();
    if (email) createP.append('email', email);
    if (name) createP.append('name', name);
    if (phone) {
      createP.append('phone', phone);
      createP.append('metadata[customer_phone]', phone);
      createP.append('metadata[display_phone]', phone);
    }
    if (meta.business_name || name) createP.append('metadata[business_name]', meta.business_name || name);
    if (meta.demo_slug) createP.append('metadata[demo_slug]', meta.demo_slug);
    if (meta.demo_url) createP.append('metadata[demo_url]', meta.demo_url);
    createP.append('metadata[studio]', 'WynnPages Australia');
    createP.append('metadata[flow_type]', flowTypeRaw);
    const createdRes = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: createP.toString()
    }).catch(() => null);
    if (createdRes && createdRes.ok) {
      cust = await createdRes.json().catch(() => null);
    }
  }

  const isOutbound = flowTypeRaw === 'outbound' || Boolean(cust && cust.metadata && cust.metadata.flow_type === 'outbound');
  const resolvedFlow = isOutbound ? 'outbound' : 'inbound';
  const resolvedPhone = phone || (cust && cust.phone) || (cust && cust.metadata && cust.metadata.customer_phone) || '';
  const resolvedEmail = email || (cust && cust.email) || (cust && cust.metadata && cust.metadata.customer_email) || '';
  const resolvedName = name || (cust && cust.name) || '';
  const resolvedBiz = (cust && cust.metadata && cust.metadata.business_name) || meta.business_name || resolvedName || resolvedEmail || 'New Client';
  const resolvedSlug = (cust && cust.metadata && cust.metadata.demo_slug) || meta.demo_slug || slugifyName(resolvedBiz);
  const resolvedDemoUrl = (cust && cust.metadata && cust.metadata.demo_url) || meta.demo_url || (resolvedSlug ? `https://${resolvedSlug}.wynnpages.com.au` : '');
  const resolvedCid = (cust && cust.id) || customerIdHint || `cs_${sid}`;

  const { invoiceUrl, invoicePdf, invoiceNumber } = await retrieveStripeInvoiceUrls(sessionData, cfg.stripeSecretKey);
  const effectiveInvoiceUrl = invoiceUrl || invoicePdf || '';
  const amountTotal = Number(sessionData.amount_total || 59900);
  const amountAudShort = `$${Math.round(amountTotal / 100)} AUD`;
  const amountAudExact = `$${(amountTotal / 100).toFixed(2)} AUD`;
  const paidAtAu = formatAuDateTime(new Date(), AU_TIMEZONE);

  const portalUrl = isOutbound
    ? `${origin}/revision?client_id=${encodeURIComponent(resolvedCid)}${resolvedEmail ? `&email=${encodeURIComponent(resolvedEmail)}` : ''}`
    : `${origin}/onboarding?client_id=${encodeURIComponent(resolvedCid)}&type=organic&session_id=${encodeURIComponent(sid)}${resolvedEmail ? `&email=${encodeURIComponent(resolvedEmail)}` : ''}`;

  // Check unified idempotency flag so post-payment alerts/email/SMS never fire twice
  const db = getD1(env);
  let d1Notified = false;
  if (db) {
    await ensureD1Schema(env);
    const existingRow = await db.prepare('SELECT metadata_json FROM clients WHERE id = ?').bind(resolvedCid).first().catch(() => null);
    if (existingRow && existingRow.metadata_json) {
      try {
        const parsedMeta = JSON.parse(existingRow.metadata_json);
        if (parsedMeta && parsedMeta.paymentNotified === true) d1Notified = true;
      } catch (_) {}
    }
  }
  const custAlreadyNotified = Boolean(cust && cust.metadata && (cust.metadata.payment_notified === 'true' || cust.metadata.welcome_sent === 'true'));
  let shouldNotify = !custAlreadyNotified && !d1Notified;
  if (shouldNotify) {
    shouldNotify = await acquireD1RateLock(env, `payment_notified:${sid}`, 31536000);
  }

  // Persist paid status, phone, and invoice metadata to Stripe Customer
  if (cust && cust.id && cfg.stripeSecretKey) {
    const uParams = new URLSearchParams();
    if (resolvedEmail && !cust.email) uParams.append('email', resolvedEmail);
    if (resolvedName && !cust.name) uParams.append('name', resolvedName);
    if (resolvedPhone) {
      uParams.append('phone', resolvedPhone);
      uParams.append('metadata[customer_phone]', resolvedPhone);
      if (!cust.metadata || !cust.metadata.display_phone) uParams.append('metadata[display_phone]', resolvedPhone);
    }
    uParams.append('metadata[studio]', 'WynnPages Australia');
    uParams.append('metadata[payment_status]', 'paid');
    uParams.append('metadata[deal_status]', 'claimed');
    uParams.append('metadata[deal_expires_at]', '');
    uParams.append('metadata[nurture_auto_enabled]', 'false');
    uParams.append('metadata[turbo_test_mode]', 'false');
    uParams.append('metadata[fb_due_step]', '');
    uParams.append('metadata[flow_type]', resolvedFlow);
    uParams.append('metadata[checkout_session_id]', sid);
    if (effectiveInvoiceUrl) uParams.append('metadata[invoice_url]', effectiveInvoiceUrl.slice(0, 490));
    if (invoiceNumber) uParams.append('metadata[invoice_number]', invoiceNumber.slice(0, 120));
    if (isOutbound) {
      uParams.append('metadata[stage]', 'outbound_paid');
    } else if (!cust.metadata || !cust.metadata.brief_status || cust.metadata.stage === 'checkout_started' || !cust.metadata.stage) {
      uParams.append('metadata[stage]', 'paid');
    }
    if (shouldNotify || !custAlreadyNotified) {
      uParams.append('metadata[payment_notified]', 'true');
      uParams.append('metadata[welcome_sent]', 'true');
    }
    await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: uParams.toString()
    }).catch(() => {});

    if (!cust.metadata) cust.metadata = {};
    cust.metadata.payment_status = 'paid';
    cust.metadata.deal_status = 'claimed';
    cust.metadata.deal_expires_at = '';
    cust.metadata.nurture_auto_enabled = 'false';
    cust.metadata.turbo_test_mode = 'false';
    cust.metadata.fb_due_step = '';
    cust.metadata.flow_type = resolvedFlow;
    cust.metadata.checkout_session_id = sid;
    cust.metadata.payment_notified = 'true';
    cust.metadata.welcome_sent = 'true';
    if (isOutbound) cust.metadata.stage = 'outbound_paid';
    else if (!cust.metadata.stage || cust.metadata.stage === 'checkout_started') cust.metadata.stage = 'paid';
    if (resolvedPhone) {
      cust.phone = resolvedPhone;
      cust.metadata.customer_phone = resolvedPhone;
      if (!cust.metadata.display_phone) cust.metadata.display_phone = resolvedPhone;
    }
  }

  // AUTO-STOP SAFETY: Immediately cancel any pending scheduled follow-up/expiry SMS for this paying client
  await cancelPendingScheduledSmsForCustomer(env, resolvedCid, resolvedPhone);

  const baseRecord = cust ? formatCustomerRecord(cust) : {
    id: resolvedCid,
    name: resolvedName,
    businessName: resolvedBiz,
    email: resolvedEmail,
    phone: resolvedPhone,
    displayPhone: resolvedPhone,
    demoSlug: resolvedSlug,
    demoUrl: resolvedDemoUrl,
    flowType: resolvedFlow,
    stage: isOutbound ? 'outbound_paid' : 'paid',
    paymentStatus: 'paid',
    dealStatus: 'claimed',
    checkoutSessionId: sid
  };
  await upsertD1Client(env, {
    ...baseRecord,
    paymentStatus: 'paid',
    dealStatus: 'claimed',
    paymentNotified: true,
    invoiceUrl: effectiveInvoiceUrl,
    invoiceNumber,
    checkoutSessionId: sid
  });
  await syncClientsKvSnapshot(env);

  if (shouldNotify) {
    const portalLabel = isOutbound ? 'Review Website Details & Choose Domain' : 'Complete Your 2-Min Business Details';
    const emailSubject = isOutbound
      ? `Tax Invoice & Next Step: Finalise Your ${resolvedBiz} Website (${invoiceNumber})`
      : `Tax Invoice & Welcome: Let's Build Your ${resolvedBiz} Website (${invoiceNumber})`;
    const emailHtml = buildTaxInvoiceEmailHtml({
      businessName: resolvedBiz,
      customerName: resolvedName,
      customerEmail: resolvedEmail,
      customerPhone: resolvedPhone,
      amountAud: amountAudExact,
      invoiceNumber,
      paidAtAu,
      invoiceUrl: effectiveInvoiceUrl,
      portalUrl,
      portalLabel,
      abn: cfg.abn || '',
      isOutbound
    });

    const smsPortalUrl = isOutbound
      ? `${origin}/revision?client_id=${encodeURIComponent(resolvedCid)}`
      : `${origin}/onboarding?client_id=${encodeURIComponent(resolvedCid)}&type=organic`;

    const smsText = isOutbound
      ? `Hi ${resolvedBiz}, it's Wynn here! Thank you so much for claiming your website (${amountAudShort}) — I'm thrilled to get this live for you. Whenever you're ready, pop in your domain name and any little tweaks you'd like me to make right here: ${smsPortalUrl} — I'll take care of the rest! Warmly, Wynn`
      : `Hi ${resolvedBiz}, it's Wynn here from WynnPages! Thank you so much for your order (${amountAudShort}) — I'm really excited to start crafting your website. Whenever you have 2 minutes, pop in your business details here so I can get started: ${smsPortalUrl} Warmly, Wynn`;

    const tgMessage = [
      `🏢 Khách hàng: ${resolvedBiz}`,
      `📧 Email: ${resolvedEmail || 'N/A'}`,
      `📱 SĐT: ${resolvedPhone || 'Chưa có'}`,
      `🔗 Portal: ${portalUrl}`
    ].join('\n');

    const notifyPipeline = Promise.all([
      // 1. Instant iPhone Telegram + Activity Feed notification
      recordActivityAndNotify({
        type: 'payment_received',
        title: `💰 ĐƠN HÀNG MỚI ${amountAudShort}!`,
        message: tgMessage,
        clientName: resolvedBiz,
        slug: resolvedSlug,
        dedupeKey: `paid_notified:${sid}`,
        env,
        ctx
      }).catch((err) => {
        console.error('[post-payment telegram]', err && err.message ? err.message : err);
      }),

      // 2. Official Tax Invoice + Portal Link Email via Resend
      (async () => {
        let payEmailRes = { sent: false, reason: 'Chưa có Email' };
        try {
          if (resolvedEmail) {
            payEmailRes = await sendResendEmail({ to: resolvedEmail, subject: emailSubject, html: emailHtml, cfg });
            if (cust && cust.id && cfg.stripeSecretKey) {
              const logP = new URLSearchParams();
              logP.append(
                'metadata[last_email_log]',
                (payEmailRes.sent ? `OK (${resolvedEmail}) [tax_invoice] @ ${new Date().toISOString()}` : `ERR: ${payEmailRes.reason || 'Failed'} [tax_invoice]`).slice(0, 480)
              );
              await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: logP.toString()
              }).catch(() => {});
            }
          }
        } catch (err) {
          payEmailRes = { sent: false, reason: (err && err.message) || 'Email error' };
          console.error('[post-payment email]', payEmailRes.reason);
        }
        return payEmailRes;
      })(),

      // 3. Direct Portal Magic Link SMS via ClickSend (AU mobile 04/+614 only)
      (async () => {
        let paySmsRes = { sent: false, reason: 'Không có SĐT di động Úc' };
        try {
          if (resolvedPhone && isValidAuMobile(resolvedPhone)) {
            paySmsRes = await sendClickSendSms(resolvedPhone, smsText, cfg);
            await recordSmsHistory({
              customerId: resolvedCid,
              type: isOutbound ? 'outbound_paid_confirmed' : 'payment_confirmed',
              to: paySmsRes.to || normalizeAuPhone(resolvedPhone),
              text: smsText,
              status: paySmsRes && paySmsRes.sent,
              reason: paySmsRes && paySmsRes.reason,
              env,
              stripeSecretKey: cfg.stripeSecretKey
            }).catch(() => {});
          }
        } catch (err) {
          paySmsRes = { sent: false, reason: (err && err.message) || 'SMS error' };
          console.error('[post-payment sms]', paySmsRes.reason);
        }
        return paySmsRes;
      })()
    ]).then(async ([, payEmailRes, paySmsRes]) => {
      await notifyTelegramAutomatedComms({
        env,
        ctx,
        client: { id: resolvedCid, businessName: resolvedBiz, demoSlug: resolvedSlug, email: resolvedEmail, phone: resolvedPhone },
        triggerType: 'post_payment_comms',
        icon: '🧾',
        title: `🧾 [SAU THANH TOÁN ${amountAudShort}] Đã gửi Invoice & Portal cho ${resolvedBiz}`,
        smsSent: Boolean(paySmsRes && paySmsRes.sent),
        smsSkippedReason: paySmsRes && paySmsRes.reason,
        smsTo: (paySmsRes && paySmsRes.to) || resolvedPhone,
        smsText,
        emailSent: Boolean(payEmailRes && payEmailRes.sent),
        emailSkippedReason: payEmailRes && payEmailRes.reason,
        emailTo: resolvedEmail,
        emailSubject,
        waitForTelegram: true
      });
    });

    runInBg(ctx, notifyPipeline);
  }

  return {
    ok: true,
    paid: true,
    sessionId: sid,
    cid: resolvedCid,
    email: resolvedEmail,
    name: resolvedName,
    businessName: resolvedBiz,
    phone: resolvedPhone,
    flowType: resolvedFlow,
    portalUrl,
    invoiceUrl: effectiveInvoiceUrl,
    invoiceNumber,
    paymentNotified: shouldNotify
  };
}

function buildDomainGuideUrl({ origin, client = {}, tab = '', ns = '' }) {
  const rawDom = String(client.liveUrl || client.existingDomain || client.desiredDomains || '').trim();
  const cleanDom = (rawDom && rawDom.toUpperCase() !== 'TBD') ? rawDom : '';
  const resolvedTab = tab || ((client.existingDomain || client.liveUrl) ? 'existing' : 'new');
  const params = new URLSearchParams();
  if (cleanDom) params.set('domain', cleanDom);
  const displayName = String(client.businessName || client.name || '').trim();
  if (displayName) params.set('name', displayName);
  if (client.email) params.set('email', String(client.email).trim());
  if (client.id) params.set('cid', String(client.id).trim());
  params.set('tab', resolvedTab);
  if (ns) params.set('ns', ns);
  return `${origin}/domain-guide?${params.toString()}`;
}

async function triggerLifecycleNotification({ stage, client, origin, cfg, env = null, ctx = null, suppressTelegram = false, waitForTelegram = false }) {
  const firstName = (client.name || 'mate').split(' ')[0];
  const email = client.email || '';
  const phone = client.phone || '';
  const demoUrl = client.demoUrl || (client.demoSlug ? `https://${client.demoSlug}.wynnpages.com.au` : `${origin}`);
  const onboardingBriefUrl = `${origin}/onboarding?client_id=${encodeURIComponent(client.id || '')}&type=organic&email=${encodeURIComponent(email)}`;
  const demoBriefUrl = `${origin}/onboarding?client_id=${encodeURIComponent(client.id || '')}&type=demo&email=${encodeURIComponent(email)}`;

  let smsText = '';
  let emailSubject = '';
  let emailHtml = '';

  const shortDemoUrl = client.demoSlug ? `https://${client.demoSlug}.wynnpages.com.au` : demoUrl;

  if (stage === 'payment_confirmed') {
    const bizLabel = client.businessName || client.name || 'your business';
    const paidLabel = client.dealStatus === 'flash_deal' || client.dealType === 'flash_deal_50' ? '$299 AUD' : '$599 AUD';
    const smsOnboardingUrl = `${origin}/onboarding?client_id=${encodeURIComponent(client.id || '')}&type=organic`;
    smsText = `Hi ${bizLabel}, it's Wynn here from WynnPages! Thank you so much for your order (${paidLabel}) — I'm really excited to start crafting your website. Whenever you have a spare 2 minutes, pop in your business details here so I can get started: ${smsOnboardingUrl} Warmly, Wynn`;
    emailSubject = `Thank you & Tax Invoice: Let's start crafting your ${bizLabel} website`;
    emailHtml = buildTaxInvoiceEmailHtml({
      businessName: bizLabel,
      customerName: client.name || '',
      customerEmail: email,
      customerPhone: phone,
      amountAud: paidLabel === '$299 AUD' ? '$299.00 AUD' : '$599.00 AUD',
      invoiceNumber: client.invoiceNumber || '',
      paidAtAu: formatAuDateTime(new Date(), AU_TIMEZONE),
      invoiceUrl: client.invoiceUrl || '',
      portalUrl: onboardingBriefUrl,
      portalLabel: 'Share Your Business Details With Wynn',
      abn: cfg.abn || '',
      isOutbound: false
    });
  } else if (stage === 'brief_completed') {
    const domainInfo = client.existingDomain || client.desiredDomains || 'your domain';
    const hasExisting = Boolean(client.existingDomain);
    const isSelfNs = hasExisting && client.dnsMode === 'self_ns' && Boolean(client.cfNameservers);
    const isAlreadyDelegated = Boolean(client.domainDelegated);
    const domainGuideUrl = buildDomainGuideUrl({
      origin,
      client,
      tab: hasExisting ? 'existing' : 'new',
      ns: isSelfNs ? (client.cfNameservers || '') : ''
    });
    const smsDomainGuideUrl = `${origin}/domain-guide?cid=${encodeURIComponent(client.id || '')}&tab=${hasExisting ? 'existing' : 'new'}`;

    if (isAlreadyDelegated) {
      smsText = `Hi ${firstName}, Wynn here! I've got all your domain details now and I'm setting everything up for your launch. Sit tight and relax — I'll text you the moment your website is officially live! Warmly, Wynn`;
      emailSubject = `All received, ${firstName}! I'm connecting ${domainInfo} for you now`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Personal Note from Wynn • Hands-Free Domain Setup Underway',
        heading: `Thank you, ${firstName} — I'm preparing your launch!`,
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Just letting you know I've received all your final details for <strong>${domainInfo}</strong>.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
            <div><strong>Launch Domain:</strong> ${domainInfo}</div>
            <div style="margin-top:6px;"><strong>Domain Setup:</strong> Handled personally by Wynn (Received ✓)</div>
            ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
          </div>
          <p><strong>You don't need to lift a finger from here.</strong> I'm personally configuring your website on our Australian high-speed network while keeping 100% of your legal ownership and existing emails intact.</p>
          <p>I'll send you a text and email the moment <strong>${domainInfo}</strong> is live!</p>
          <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
        `,
        primaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else if (isSelfNs) {
      const nsParts = String(client.cfNameservers || '').split(',').map((s) => s.trim()).filter(Boolean);
      smsText = `Hi ${firstName}, Wynn here! Thanks for sending your domain details through. I've just emailed you the nameservers, or you can view the simple setup guide here: ${smsDomainGuideUrl} — Let me know if you'd like me to help with it! Warmly, Wynn`;
      emailSubject = `Your domain nameservers for ${domainInfo} (from Wynn)`;
      emailHtml = buildAtelierEmailHtml({
        preheader: `Nameservers Ready for ${domainInfo}`,
        heading: `Your domain nameservers are ready, ${firstName}.`,
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Thank you for sending your details through! I've set up <strong>${domainInfo}</strong> on our Australian high-speed network.</p>
          <p>Whenever you or your IT person are ready, simply replace the current <strong>Nameservers</strong> for <strong>${domainInfo}</strong> with these two:</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px 18px;margin:18px 0;font-family:monospace;font-size:13px;line-height:1.8;">
            <div><strong>Nameserver 1:</strong> <span style="color:#96432b;font-weight:bold;">${nsParts[0] || ''}</span></div>
            ${nsParts[1] ? `<div><strong>Nameserver 2:</strong> <span style="color:#96432b;font-weight:bold;">${nsParts[1]}</span></div>` : ''}
          </div>
          <p>If that looks a bit technical, don't stress at all — just click the button below and I'll happily connect it for you for free.</p>
          <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
        `,
        primaryCta: {
          label: 'Open Easy Domain Guide',
          url: domainGuideUrl
        },
        secondaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else if (hasExisting) {
      smsText = `Hi ${firstName}, Wynn here! I've received your website notes and domain details. Whenever you have 2 minutes, here's the simple step-by-step guide so we can connect your domain: ${smsDomainGuideUrl} — Shout out if you need a hand!`;
      emailSubject = `Got your details, ${firstName}! Next step: connecting ${domainInfo}`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Personal Note from Wynn • Free Domain Connection Help',
        heading: `I'm putting the finishing touches on your website, ${firstName}.`,
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Thank you so much for sending your details through! I've got everything logged and I'm preparing your website for launch.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
            <div><strong>Your Domain:</strong> ${domainInfo}</div>
            ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
            ${client.brandColors ? `<div style="margin-top:6px;"><strong>Brand Palette:</strong> ${client.brandColors}</div>` : ''}
          </div>
          <p><strong>How we can connect ${domainInfo} without any technical headache:</strong></p>
          <ul>
            <li><strong>Option 1 (Easiest):</strong> Invite <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> as a delegated user inside your VentraIP or GoDaddy account, OR</li>
            <li><strong>Option 2 (60-Second Concierge):</strong> Share temporary domain access via the secure guide below and I'll jump in and connect it for you personally.</li>
          </ul>
          <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
        `,
        primaryCta: {
          label: 'Open Your Domain Guide',
          url: domainGuideUrl
        },
        secondaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else {
      smsText = `Hi ${firstName}, Wynn here! I've got all your website details. The last little step is registering your domain name under your own name — I made a super simple 2-minute guide for you here: ${smsDomainGuideUrl} Warmly, Wynn`;
      emailSubject = `Got your details, ${firstName}! Here is your easy 2-minute domain guide`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Personal Note from Wynn • 2-Minute Domain Guide Inside',
        heading: `Getting ready for your launch, ${firstName}.`,
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Thank you for sending your details through! Your website is ready to be connected to <strong>${domainInfo}</strong>.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
            <div><strong>Chosen Domain:</strong> ${domainInfo}</div>
            ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
            ${client.brandColors ? `<div style="margin-top:6px;"><strong>Brand Palette:</strong> ${client.brandColors}</div>` : ''}
          </div>
          <p>Because I want you to own <strong>${domainInfo}</strong> 100% under your own name and ABN (so no agency ever holds your domain hostage), here is all you need to do:</p>
          <ol>
            <li>Register <strong>${domainInfo}</strong> directly on <strong>VentraIP Australia</strong> in your own name with <strong>Auto-Renew ON</strong>.</li>
            <li>Under <em>Profile Settings &rarr; Additional Users</em>, invite <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> and click confirm inside the guide below — I'll handle all the technical DNS setup for you from there!</li>
          </ol>
          <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
        `,
        primaryCta: {
          label: 'Open Step-by-Step Domain Guide',
          url: domainGuideUrl
        },
        secondaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    }
  } else if (stage === 'demo_ready') {
    smsText = `Hi ${firstName}! It's Wynn here from WynnPages. I've just finished putting together the first live preview of your website: ${shortDemoUrl} — Have a browse whenever you're free and let me know how it feels!`;
    emailSubject = `Your custom website preview is ready to explore, ${firstName}!`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Personal Note from Wynn • Live Website Preview Inside',
      heading: `I've finished crafting your website preview, ${firstName}!`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>I've just finished hand-crafting the initial version of your website, and I'd love for you to take it for a spin on your phone or laptop:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${demoUrl}" style="color:#96432b;font-weight:bold;">${demoUrl}</a>
        </p>
        <p>Have a play around with it whenever you get a quiet moment. Once you're happy with the direction, you can upload your logo, menu/price list, and domain details using the second button below, or simply reply to this email with any tweaks you'd like me to make.</p>
        <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
      `,
      primaryCta: {
        label: 'Explore Your Website Preview',
        url: demoUrl
      },
      secondaryCta: {
        label: 'Upload Logo, Menu & Domain Details',
        url: demoBriefUrl
      }
    });
  } else if (stage === 'demo_reminder') {
    smsText = `Hi ${firstName}, hope your week is going well! It's Wynn here from WynnPages. Just checking in to see if you had a chance to look over your website preview: ${shortDemoUrl} — Always happy to tweak any colours, photos, or prices for you!`;
    emailSubject = `Friendly check-in on your website preview, ${firstName}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Quick check-in from Wynn',
      heading: `How are you feeling about your website preview, ${firstName}?`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>Hope you're having a great week! I just wanted to check in and see what you thought of your live website preview:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${demoUrl}" style="color:#96432b;font-weight:bold;">${demoUrl}</a>
        </p>
        <p>Whenever you're ready for me to put the finishing touches on it, you can upload your final logo and price list via the button below, or reply directly to this email with any changes you'd love to see.</p>
        <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
      `,
      primaryCta: {
        label: 'Review Preview & Send Final Details',
        url: demoBriefUrl
      },
      secondaryCta: {
        label: 'Open Live Preview',
        url: demoUrl
      }
    });
  } else if (stage === 'outbound_pitch') {
    const bizLabel = client.businessName || client.name || 'your business';
    const previewLink = shortDemoUrl;
    smsText = buildNurtureStepSms({ stepKey: 'step1', biz: bizLabel, demoUrl: previewLink });
    emailSubject = `A little website concept I put together for ${bizLabel}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Personal note from Wynn at WynnPages Studio',
      heading: `Something I put together for ${bizLabel}.`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>I hope your week is going really well! My name is Wynn, and I'm a web designer here in Australia.</p>
        <p>I came across <strong>${bizLabel}</strong> recently and really loved what you do. Rather than sending a boring cold pitch, I decided to actually sit down and hand-craft a complete, mobile-ready website concept tailored specifically to your business so you could see how it looks and feels in real life:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a>
        </p>
        <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.65;color:#231f1a;">
          <strong style="color:#96432b;display:block;margin-bottom:4px;">✓ 100% Tailored to Your Business After Checkout:</strong>
          Please note that the preview currently uses stand-in concept photos and sample service details just to demonstrate the layout. The moment you claim the website via our secure checkout, you'll be redirected straight to your private <strong>WynnPages Customisation Portal</strong> where you can upload your real photos, logo, exact pricing/licences, and domain preferences — and I will personally tailor every detail for you before launch.
        </div>
        <p>There's zero pressure at all — please just have a browse whenever you get a quiet cuppa ($599 AUD flat one-off build, 100% owned by you with $0 ongoing monthly fees forever).</p>
        <p>Feel free to reply to this email anytime if you have any thoughts or questions!</p>
        <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>
      `,
      primaryCta: {
        label: 'Have a Look at Your Website Concept',
        url: previewLink
      }
    });
  } else if (stage === 'outbound_paid_confirmed') {
    const bizLabel = client.businessName || client.name || 'your business';
    const revisionUrl = `${origin}/revision?client_id=${encodeURIComponent(client.id || '')}${email ? `&email=${encodeURIComponent(email)}` : ''}`;
    const smsRevisionUrl = `${origin}/revision?client_id=${encodeURIComponent(client.id || '')}`;
    const paidLabel = client.dealStatus === 'flash_deal' || client.dealType === 'flash_deal_50' ? '$299.00 AUD' : '$599.00 AUD';
    smsText = `Hi ${bizLabel}, it's Wynn here! Thank you so much for claiming your website — I'm thrilled to get this live for you. Whenever you're ready, pop in your domain name and any tweaks you'd like me to make right here: ${smsRevisionUrl} Warmly, Wynn`;
    emailSubject = `Thank you & Tax Invoice: Let's finalise your ${bizLabel} website`;
    emailHtml = buildTaxInvoiceEmailHtml({
      businessName: bizLabel,
      customerName: client.name || '',
      customerEmail: email,
      customerPhone: phone,
      amountAud: paidLabel,
      invoiceNumber: client.invoiceNumber || '',
      paidAtAu: formatAuDateTime(new Date(), AU_TIMEZONE),
      invoiceUrl: client.invoiceUrl || '',
      portalUrl: revisionUrl,
      portalLabel: 'Share Any Tweaks & Choose Your Domain',
      abn: cfg.abn || '',
      isOutbound: true
    });
  } else if (stage === 'outbound_revision_submitted') {
    const bizLabel = client.businessName || client.name || 'your business';
    const hasExisting = Boolean(client.existingDomain || client.liveUrl);
    const rawDomainLabel = String(client.liveUrl || client.existingDomain || client.desiredDomains || '').trim();
    const domainLabel = (rawDomainLabel && rawDomainLabel.toUpperCase() !== 'TBD') ? rawDomainLabel : 'your domain';
    const guideNewUrl = buildDomainGuideUrl({ origin, client, tab: 'new' });
    const guideExistingUrl = buildDomainGuideUrl({ origin, client, tab: 'existing' });
    const defaultGuideUrl = hasExisting ? guideExistingUrl : guideNewUrl;
    const smsGuideUrl = `${origin}/domain-guide?cid=${encodeURIComponent(client.id || '')}&tab=${hasExisting ? 'existing' : 'new'}`;

    if (client.domainDelegated || client.domainConciergeRequested) {
      smsText = `Hi ${bizLabel}, Wynn here! I've received all your website updates and domain details, and I'm working on your launch right now. Sit tight — I'll text you the moment your website is officially live! Warmly, Wynn`;
      emailSubject = `Got your updates, ${firstName}! I'm preparing ${bizLabel} for launch`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Personal Note from Wynn • Preparing Your Official Launch',
        heading: `Thank you, ${firstName} — I'm polishing ${bizLabel} for launch!`,
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Just letting you know I've received your website updates${domainLabel ? ` and domain details for <strong>${domainLabel}</strong>` : ''}.</p>
          <p>I'm personally applying your final touches and connecting your domain on our Australian high-speed network over the next <strong>24–48 hours</strong>.</p>
          <p>I'll send you a text and email the moment your official website is live!</p>
          <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
        `,
        primaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else {
      smsText = `Hi ${bizLabel}, Wynn here! I've got your website updates and I'm working on them now. The last little step is connecting your domain name — here's the simple 2-minute guide I put together for you: ${smsGuideUrl} — Let me know if you need a hand!`;
      emailSubject = `Got your updates! Next step: connecting the domain for ${bizLabel}`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Personal Note from Wynn • 2-Minute Domain Guide Inside',
        heading: `I'm polishing ${bizLabel} for launch, ${firstName}!`,
        bodyHtml: `
          <p>Hi ${firstName},</p>
          <p>Thank you for sending your website updates through! I've started applying your tweaks so everything is ready for launch within <strong>24–48 hours</strong>.</p>
          <p><strong>While I polish the site, let's get your domain connected${domainLabel ? ` (<strong>${domainLabel}</strong>)` : ''}:</strong> I always make sure you own your domain <strong>100% directly under your own name</strong> with zero middleman markups.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px 18px;margin:18px 0;font-size:13px;line-height:1.7;">
            <div style="margin-bottom:8px;"><strong>Option A — Need a new .com.au or .com domain? (~2 mins)</strong><br>Follow the visual guide below to register directly on <strong>VentraIP Australia</strong> in your own name and invite <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> — I'll handle all the technical setup for free.</div>
            <div><strong>Option B — Already own a domain or want me to do it for you? (~60 secs)</strong><br>Choose <em>"I Already Own a Domain"</em> in the guide or simply reply to this email and I'll connect it for you personally.</div>
          </div>
          <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>WynnPages Studio</p>
        `,
        primaryCta: {
          label: hasExisting ? 'Connect My Existing Domain' : 'Open 2-Minute Domain Guide',
          url: defaultGuideUrl
        },
        secondaryCta: {
          label: hasExisting ? 'Need a New Domain? View VentraIP Guide' : 'Already Own a Domain? Connect Here',
          url: hasExisting ? guideNewUrl : guideExistingUrl
        }
      });
    }
  } else if (stage === 'outbound_followup') {
    const bizLabel = client.businessName || client.name || 'your business';
    const previewLink = shortDemoUrl;
    const isDeal = client.dealStatus === 'flash_deal';
    smsText = buildNurtureStepSms({
      stepKey: isDeal ? 'step3' : 'step2',
      biz: bizLabel,
      demoUrl: previewLink,
      views: Number(client.demoViewCount || 0)
    });
    emailSubject = isDeal
      ? `I'd love to see ${bizLabel} use this design (a personal note from Wynn)`
      : `Just checking in on the website concept I made for ${bizLabel}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: isDeal ? 'Personal studio gesture — $299 AUD all-up, zero monthly fees' : 'A friendly note from Wynn at WynnPages Studio',
      heading: `Hope your week is going well, ${firstName}.`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>I know how busy things get running <strong>${bizLabel}</strong>, so I just wanted to send a warm follow-up in case my previous note got buried.</p>
        <p>I'm still holding the custom website concept I hand-crafted for your business right here:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a>
        </p>
        ${isDeal ? `<div style="background-color:#fcf9f3;border:1px solid #d49b28;border-radius:12px;padding:14px 16px;font-size:13.5px;color:#44403c;"><strong>A personal gesture from me:</strong> Since the design is already built for you, I've halved the one-off build fee on your preview link down to <strong>$299 AUD all-up</strong> (save $300 AUD, with zero monthly fees forever).</div>` : ''}
        <p><strong>100% Tailored After Checkout:</strong> The preview currently uses sample photos and placeholder details just to show the layout. Once you claim the website on the preview page, you'll get instant access to your private <strong>Customisation Portal</strong> where you can upload your real photos, logo, and exact pricing/details for me to personally update before connecting your <code>.com.au</code> domain.</p>
        <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>
      `,
      primaryCta: {
        label: isDeal ? 'View Preview & Claim for $299 AUD' : 'Open Your Website Preview',
        url: previewLink
      }
    });
  } else if (stage === 'site_launched') {
    const rawLiveDomain = (client.liveUrl || client.existingDomain || client.desiredDomains || '').trim();
    const liveUrl = rawLiveDomain.startsWith('http') ? rawLiveDomain : `https://${rawLiveDomain}`;
    smsText = `Hi ${firstName}, it's Wynn here! I'm so excited to let you know that your new custom website is officially LIVE on your domain — 100% yours with $0 ongoing monthly fees! Check your email for your live link or take a look here: ${shortDemoUrl} — Thank you so much for trusting me with your website! Warmly, Wynn`;
    emailSubject = `Congratulations, ${firstName}! Your new website is officially LIVE`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Personal Note from Wynn • Your Website is Officially Live',
      heading: `Your bespoke website is now live, ${firstName}!`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>Pop the champagne! I've just finished connecting everything, and your hand-crafted website is officially live on our Australian high-speed network and ready to welcome your clients.</p>
        <p>As promised, you own 100% of your website with zero ongoing monthly fees. If you shared a temporary domain password with me during setup, you can safely update your password anytime now.</p>
        <p>Thank you so much for trusting me with your business's digital home — just reply here anytime if you ever need a hand!</p>
        <p style="margin-top:16px;">Warmly,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>
      `,
      primaryCta: {
        label: 'Visit Your Live Website',
        url: liveUrl
      }
    });
  }

  const [smsResult, emailResult] = await Promise.all([
    phone ? Promise.resolve(sendClickSendSms(phone, smsText, cfg)).catch((err) => ({ sent: false, reason: (err && err.message) || 'SMS delivery error' })) : Promise.resolve({ sent: false, reason: 'No phone number on record' }),
    email ? Promise.resolve(sendResendEmail({ to: email, subject: emailSubject, html: emailHtml, cfg })).catch((err) => ({ sent: false, reason: (err && err.message) || 'Email delivery skipped' })) : Promise.resolve({ sent: false, reason: 'No email on record' })
  ]);

  let telegramRes = null;
  if (!suppressTelegram && env && (smsResult.sent || emailResult.sent || phone || email)) {
    const stageTitles = {
      outbound_pitch: '🚀 [BƯỚC 1 - PITCH DEMO] Đã gửi SMS & Email chào hàng',
      outbound_followup: client.dealStatus === 'flash_deal'
        ? '🔥 [DEAL 50% $299] Đã gửi SMS & Email Follow-up'
        : '💬 [CHĂM SÓC DEMO] Đã gửi SMS & Email Follow-up',
      payment_confirmed: '💳 [XÁC NHẬN ĐƠN HÀNG] Đã gửi Tax Invoice + Portal',
      outbound_paid_confirmed: '💳 [CHỐT SALE DEMO] Đã gửi Tax Invoice + Revision Portal',
      brief_completed: '📝 [ONBOARDING BRIEF] Đã gửi SMS & Email hướng dẫn Domain',
      outbound_revision_submitted: '✏️ [NHẬN YÊU CẦU CHỈNH SỬA] Đã gửi SMS & Email Domain Guide',
      demo_ready: '🎨 [DEMO SẴN SÀNG] Đã gửi SMS & Email mời xem Web',
      demo_reminder: '👋 [NHẮC XEM DEMO] Đã gửi SMS & Email check-in',
      site_launched: '🌐 [LÊN SÓNG LIVE] Đã gửi SMS & Email chúc mừng khai trương'
    };
    const bizTitle = client.businessName || client.name || 'Khách hàng';
    telegramRes = await notifyTelegramAutomatedComms({
      env,
      ctx,
      client,
      triggerType: `lifecycle_${stage}`,
      icon: '📩',
      title: `${stageTitles[stage] || `📩 [GỬI THÔNG BÁO: ${stage}]`} — ${bizTitle}`,
      views: client.demoViewCount !== undefined ? client.demoViewCount : null,
      smsSent: Boolean(smsResult && smsResult.sent),
      smsSkippedReason: smsResult && smsResult.reason,
      smsTo: (smsResult && smsResult.to) || phone,
      smsText,
      emailSent: Boolean(emailResult && emailResult.sent),
      emailSkippedReason: emailResult && emailResult.reason,
      emailTo: email,
      emailSubject,
      waitForTelegram
    });
  }

  return { smsResult, emailResult, stage, smsText, phone, emailSubject, telegramNotified: Boolean(telegramRes && telegramRes.telegramSent) };
}

function buildNurtureStepSms({ stepKey, biz, demoUrl, views = 0 }) {
  const b = (biz || 'there').trim();
  const url = (demoUrl || 'https://wynnpages.com.au').trim();
  if (stepKey === 'step1' || stepKey === 'aussie_pitch' || stepKey === 'pitch') {
    return `Hi ${b}, Wynn from WynnPages Studio. I loved your local vibe so I mocked up a custom website concept for you: ${url} (sample photos - we tailor 100% with your real photos, prices & .com.au domain once claimed, $599 flat, $0/mth). No pressure! Warmly, Wynn`;
  }
  if (stepKey === 'aussie_followup_views' || stepKey === 'followup_views') {
    return `Hi ${b}, Wynn from WynnPages. Saw you browsed your preview (${url}) - hope you liked it! Quick note: photos & prices are samples; once claimed, our Customisation Portal lets you upload your real photos, logo & menu for me to tailor 100%. Warmly, Wynn`;
  }
  if (stepKey === 'step2' || stepKey === 'day3_reminder') {
    if (Number(views || 0) >= 2) {
      return `Hi ${b}, Wynn from WynnPages. Saw you browsed your preview (${url}) - hope you liked it! Quick note: photos & prices are samples; once claimed, our Customisation Portal lets you upload your real photos, logo & menu for me to tailor 100%. Warmly, Wynn`;
    }
    return `Hi ${b}, hope your week's going well! Wynn from WynnPages - popping your custom website preview back up in case it got buried: ${url} (sample photos shown; I personally tailor your real photos, prices & .com.au domain once claimed, $599 flat, $0/mth). Warmly, Wynn`;
  }
  if (stepKey === 'day7_nudge_0views') {
    return `Hi ${b}, hope your week's going well! Wynn from WynnPages - popping your custom website preview back up in case it got buried: ${url} (sample photos shown; I personally tailor your real photos, prices & .com.au domain once claimed, $599 flat, $0/mth). Warmly, Wynn`;
  }
  if (stepKey === 'step3' || stepKey === 'day7_deal' || stepKey === 'aussie_flash_deal_299' || stepKey === 'flash_deal_299') {
    return `Hi ${b}, Wynn from WynnPages. Your website concept is built & I'd rather see it live for you than archived - for 72h it's halved to $299 AUD all-up (usually $599, $0/mth forever), incl. full tailoring with your photos, menu & .com.au domain: ${url} Warmly, Wynn`;
  }
  if (stepKey === 'step4' || stepKey === 'day9_warning') {
    return `Hi ${b}, Wynn here - last note so I don't clutter your phone! I'm archiving your preview (${url}) tomorrow as I clear studio space. Still want it at $299 AUD one-off ($0/mth, full tailoring & .com.au setup incl.)? Grab it before tomorrow! All the best, Wynn`;
  }
  return '';
}

function buildNurtureStepEmail({ stepKey, client, demoUrl, views = 0 }) {
  const biz = (client && (client.businessName || client.name)) || 'your boutique';
  const firstName = ((client && client.name) || biz).split(/\s+/)[0] || 'there';
  const previewLink = demoUrl || (client && (client.demoUrl || client.brandedDemoUrl)) || 'https://wynnpages.com.au';
  const pBox = `<p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;"><a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a></p>`;

  if (stepKey === 'step1' || stepKey === 'aussie_pitch' || stepKey === 'pitch') {
    return {
      subject: `A little website concept I put together for ${biz}`,
      html: buildAtelierEmailHtml({
        preheader: 'Personal note from Wynn at WynnPages Studio',
        heading: `Something I hand-crafted for ${biz}.`,
        bodyHtml: `<p>Hi ${firstName},</p><p>I hope your week is going really well! My name is Wynn, and I'm a web designer here in Australia.</p><p>I came across <strong>${biz}</strong> recently and genuinely loved your vibe and reputation. Rather than sending a generic pitch, I decided to sit down and put together a complete, mobile-ready website concept tailored specifically to your business so you could see how it looks and feels in real life:</p>${pBox}<div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:14px 16px;margin:16px 0;font-size:13px;line-height:1.65;color:#231f1a;"><strong style="color:#96432b;display:block;margin-bottom:4px;">✓ 100% Tailored to Your Business After Checkout:</strong>Please note that the preview currently uses stand-in concept photos and sample details just to demonstrate the layout. The moment you claim the website via our secure checkout, you'll be redirected straight to your private <strong>WynnPages Customisation Portal</strong> where you can upload your real photos, logo, exact service pricing/licences, and domain preferences — and I will personally tailor every detail for you before launch.</div><p>There's no pressure at all — just have a browse whenever you get a quiet moment ($599 AUD flat one-off build, with $0 monthly fees forever). Feel free to reply directly to this email if you have any thoughts!</p><p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>`,
        primaryCta: { label: 'Have a Look at Your Website Preview', url: previewLink }
      })
    };
  }
  if (stepKey === 'step2' || stepKey === 'day3_reminder' || stepKey === 'aussie_followup_views' || stepKey === 'followup_views') {
    const sawMultiple = Number(views || 0) >= 2;
    return {
      subject: sawMultiple ? `So glad you had a look at the ${biz} website preview!` : `Just checking in on the website concept I made for ${biz}`,
      html: buildAtelierEmailHtml({
        preheader: sawMultiple ? 'Happy to tailor any photos, colours, or prices for you' : 'A friendly note from Wynn at WynnPages Studio',
        heading: sawMultiple ? `Happy to tailor anything for ${biz}, ${firstName}!` : `Hope your week is going well, ${firstName}!`,
        bodyHtml: sawMultiple
          ? `<p>Hi ${firstName},</p><p>I noticed you had a chance to check out the custom website preview I put together for <strong>${biz}</strong> — I really hope you liked the feel of it!</p>${pBox}<p>I just wanted to reassure you that the current photos and service details on the preview are simply stand-in placeholders to show the layout. The moment you claim the website on the preview page, you'll unlock your private <strong>WynnPages Customisation Portal</strong> where you can upload your favourite photos, update any service prices/details, or adjust colours before I connect it to your own <code>.com.au</code> domain ($599 AUD flat, $0 ongoing monthly fees).</p><p>Simply reply to this email with any questions, or claim it right on the preview page whenever you're ready!</p><p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>`
          : `<p>Hi ${firstName},</p><p>I know how busy things get running <strong>${biz}</strong>, so I just wanted to send a warm follow-up in case my earlier note got buried during a busy week!</p><p>Here is the custom website preview I put together for your business:</p>${pBox}<p>Please note I've used sample photos and placeholder details just to show the layout — once claimed on the preview page, you'll get instant access to our <strong>Customisation Portal</strong> where I personally swap in your real photos, pricing, and details so it feels 100% like you ($599 AUD one-off, zero monthly fees).</p><p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>`,
        primaryCta: { label: 'Open Your Website Preview', url: previewLink }
      })
    };
  }
  if (stepKey === 'step3' || stepKey === 'day7_deal' || stepKey === 'aussie_flash_deal_299' || stepKey === 'flash_deal_299') {
    return {
      subject: `I'd love to see ${biz} use this design (a personal note from Wynn)`,
      html: buildAtelierEmailHtml({
        preheader: 'Personal studio gesture for your business — $299 AUD all-up, zero monthly fees',
        heading: `I'd love this design to go to ${biz}, ${firstName}.`,
        bodyHtml: `<p>Hi ${firstName},</p><p>I hope you're having a lovely week! I was looking over the custom website concept I hand-crafted for <strong>${biz}</strong>, and since I've already poured the time and care into building it specifically around your brand, I would genuinely much rather see you using and enjoying it than archiving the work in my studio folder.</p><div style="background-color:#fcf9f3;border:1px solid #d49b28;border-radius:14px;padding:16px 18px;margin:18px 0;font-size:14px;line-height:1.7;color:#44403c;"><strong>A personal gesture from me:</strong> For the next 3 days, I've halved the one-off build fee on your preview page down to <strong>$299 AUD all-up</strong> (instead of $599 AUD, and still <strong>$0 monthly fees forever</strong>). Claiming on the preview page immediately unlocks your private <strong>Customisation Portal</strong> where I personally swap in your real photos, exact pricing/details, and connect your <code>.com.au</code> domain for free.</div>${pBox}<p>If you'd love to make it yours, you can claim it directly on the preview page or reply here and I'll help you get everything sorted.</p><p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>`,
        primaryCta: { label: 'View Preview & Claim for $299 AUD', url: previewLink }
      })
    };
  }
  if (stepKey === 'step4' || stepKey === 'day9_warning') {
    return {
      subject: `A gentle final note regarding the ${biz} website preview`,
      html: buildAtelierEmailHtml({
        preheader: 'Archiving your private preview link tomorrow',
        heading: `A quick, friendly note before I tidy up my studio archive`,
        bodyHtml: `<p>Hi ${firstName},</p><p>I promise this is my last note so I don't clutter your inbox! I just wanted to give you a gentle heads up that I'll be archiving the private website preview I built for <strong>${biz}</strong> tomorrow as I clear server space for upcoming projects:</p>${pBox}<p>If you'd still like to keep this design at the <strong>$299 AUD one-off rate</strong> (with $0 monthly fees and full post-checkout access to our Customisation Portal to swap in your real photos, pricing/details, and <code>.com.au</code> domain), you can grab it on the preview link anytime before tomorrow.</p><p>Either way, thank you so much for your time, and I wish you and everyone at <strong>${biz}</strong> all the very best!</p><p style="margin-top:16px;">Warmly,<br><strong>Wynn</strong><br>Founder &amp; Designer, WynnPages Studio</p>`,
        primaryCta: { label: 'Open Your Website Preview Before It Archives', url: previewLink }
      })
    };
  }
  return null;
}

function parseJsLiteralSafe(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const src = raw.trim().replace(/;\s*$/, '');
  try { return JSON.parse(src); } catch (_) {}

  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        const c = src[i];
        out += c;
        i++;
        if (c === '\\' && i < n) {
          out += src[i];
          i++;
        } else if (c === '"') {
          break;
        }
      }
      continue;
    }
    if (ch === "'") {
      out += '"';
      i++;
      while (i < n) {
        const c = src[i];
        i++;
        if (c === '\\' && i < n) {
          const next = src[i];
          i++;
          if (next === "'") out += "'";
          else if (next === '"') out += '\\"';
          else out += '\\' + next;
        } else if (c === '"') {
          out += '\\"';
        } else if (c === "'") {
          break;
        } else {
          out += c;
        }
      }
      out += '"';
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }

  let jsonStr = '';
  i = 0;
  const m = out.length;
  while (i < m) {
    const ch = out[i];
    if (ch === '"') {
      jsonStr += ch;
      i++;
      while (i < m) {
        const c = out[i];
        jsonStr += c;
        i++;
        if (c === '\\' && i < m) {
          jsonStr += out[i];
          i++;
        } else if (c === '"') {
          break;
        }
      }
      continue;
    }
    const rest = out.slice(i);
    const keyMatch = rest.match(/^([,{]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/);
    if (keyMatch) {
      jsonStr += `${keyMatch[1]}"${keyMatch[2]}"${keyMatch[3]}`;
      i += keyMatch[0].length;
      continue;
    }
    jsonStr += ch;
    i++;
  }

  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    return null;
  }
}

function parseConfigAndMenuFromHtml(html) {
  let config = null;
  let menu = null;
  if (!html) return { config, menu };

  const cfgMatch = html.match(/window\.ATELIER_CONFIG\s*=\s*(\{[\s\S]*?\n\s*\};)/);
  if (cfgMatch) {
    config = parseJsLiteralSafe(cfgMatch[1]);
  }

  const menuMatch = html.match(/window\.SALON_MENU_DATA\s*=\s*(\[[\s\S]*?\n\s*\];)/);
  if (menuMatch) {
    menu = parseJsLiteralSafe(menuMatch[1]);
  }

  return { config, menu };
}

function updateHtmlWithConfigAndMenu(html, newConfig, newMenu) {
  let updated = html;

  if (newConfig) {
    if (newConfig.palette && ['01', '02', '03', '04', '05'].includes(String(newConfig.palette))) {
      updated = updated.replace(/(<html[^>]*data-palette=")[^"]*(")/i, `$1${newConfig.palette}$2`);
    }
    updated = updated.replace(/(window\.ATELIER_CONFIG\s*=\s*)\{[\s\S]*?\n\s*\};/, (m, p1) => {
      return p1 + JSON.stringify(newConfig, null, 2) + ';';
    });

    if (newConfig.salonName) {
      updated = updated.replace(/(<span id="nav-salon-name"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.salonName}$2`);
      updated = updated.replace(/(<span id="copyright-salon"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.salonName}$2`);
      updated = updated.replace(/(<title id="page-meta-title">)[^<]*(<\/title>)/g, `$1${newConfig.salonName} — Bespoke Sanctuary | Australia$2`);
    }
    if (newConfig.heroHeadlinePrefix !== undefined) {
      updated = updated.replace(/(<span id="hero-headline-prefix"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.heroHeadlinePrefix}$2`);
    }
    if (newConfig.heroHeadlineItalic !== undefined) {
      updated = updated.replace(/(<span id="hero-headline-italic"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.heroHeadlineItalic}$2`);
    }
    if (newConfig.heroBadge) {
      updated = updated.replace(/(<span id="hero-badge-text"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.heroBadge}$2`);
    }
    if (newConfig.displayPhone) {
      updated = updated.replace(/(<a id="visit-phone-link"[^>]*>)[^<]*(<\/a>)/g, `$1${newConfig.displayPhone}$2`);
      updated = updated.replace(/(href="tel:)[^"]*(")/g, `$1${newConfig.displayPhone.replace(/[^\d+]/g, '')}$2`);
    }
    if (newConfig.address) {
      updated = updated.replace(/(<p id="visit-address"[^>]*>)[^<]*(<\/p>)/g, `$1${newConfig.address}$2`);
    }
    if (newConfig.heroStory) {
      updated = updated.replace(/(<p id="hero-story-text"[^>]*>)[^<]*(<\/p>)/g, `$1${newConfig.heroStory}$2`);
    }
    if (newConfig.logoUrl !== undefined) {
      const nextLogoSrc = newConfig.logoUrl || newConfig.fallbackLogoUrl || 'https://wynnpages.com.au/assets/atelier/nails/default-lux-logo.svg';
      updated = updated.replace(/(<img[^>]*id="nav-logo-img"[^>]*src=")[^"]*(")/i, `$1${nextLogoSrc}$2`);
      updated = updated.replace(/(<img[^>]*id="footer-monogram"[^>]*src=")[^"]*(")/i, `$1${nextLogoSrc}$2`);
    }
    if (newConfig.images) {
      if (newConfig.images.hero) {
        updated = updated.replace(/(<img[\s\S]*?id="hero-oil-img"[\s\S]*?src=")[^"]*(")/, `$1${newConfig.images.hero}$2`);
      }
      if (newConfig.images.biabFeature) {
        updated = updated.replace(/(<img[\s\S]*?id="feature-biab-img"[\s\S]*?src=")[^"]*(")/, `$1${newConfig.images.biabFeature}$2`);
      }
      if (newConfig.images.afterNail || newConfig.images.biabFeature) {
        updated = updated.replace(/(<img[\s\S]*?id="ba-after-img"[\s\S]*?src=")[^"]*(")/, `$1${newConfig.images.afterNail || newConfig.images.biabFeature}$2`);
      }
      if (newConfig.images.beforeNail) {
        updated = updated.replace(/(<img[\s\S]*?id="ba-before-img"[\s\S]*?src=")[^"]*(")/, `$1${newConfig.images.beforeNail}$2`);
      }
    }
  }

  if (newMenu) {
    updated = updated.replace(/(window\.SALON_MENU_DATA\s*=\s*)\[[\s\S]*?\n\s*\];/, (m, p1) => {
      return p1 + JSON.stringify(newMenu, null, 2) + ';';
    });
  }

  return updated;
}

async function executeGeminiAutoRevision({ currentHtml, revData = {}, menuImageBase64 = null, menuImagesBase64 = [], adminInstructions = '', geminiApiKey = '' }) {
  if (!currentHtml) return { ok: false, error: 'Missing demo HTML' };
  const { config, menu } = parseConfigAndMenuFromHtml(currentHtml);
  if (!config) return { ok: false, error: 'Could not parse ATELIER_CONFIG from demo HTML' };

  const changesSummaryList = [];

  // 1. Apply Core Info updates
  if (revData.logoUrl && revData.logoUrl.trim()) {
    changesSummaryList.push('Updated Brand Logo');
    config.logoUrl = revData.logoUrl.trim();
  }
  if (revData.bizName && revData.bizName.trim() && revData.bizName !== config.salonName) {
    changesSummaryList.push(`Business Name: "${config.salonName}" → "${revData.bizName}"`);
    config.salonName = revData.bizName.trim();
  }
  if (revData.phone && revData.phone.trim()) {
    changesSummaryList.push(`Phone: ${revData.phone}`);
    config.displayPhone = revData.phone.trim();
    config.smsPhone = revData.phone.trim();
  }
  if (revData.address && revData.address.trim()) {
    changesSummaryList.push(`Address: ${revData.address}`);
    config.address = revData.address.trim();
    config.mapsQuery = `${revData.address.trim()}, Australia`;
  }
  if (revData.bookingUrl && revData.bookingUrl.trim()) {
    changesSummaryList.push(`Booking: ${revData.bookingUrl}`);
    config.bookingUrl = revData.bookingUrl.trim();
  }
  if (revData.heroHeadline && revData.heroHeadline.trim()) {
    changesSummaryList.push(`Headline: ${revData.heroHeadline}`);
    const parts = revData.heroHeadline.trim().split(' ');
    if (parts.length > 2) {
      config.heroHeadlinePrefix = parts.slice(0, parts.length - 2).join(' ');
      config.heroHeadlineItalic = parts.slice(parts.length - 2).join(' ');
    } else {
      config.heroHeadlinePrefix = '';
      config.heroHeadlineItalic = revData.heroHeadline.trim();
    }
  }
  if (revData.heroStory && revData.heroStory.trim()) {
    changesSummaryList.push('Updated About story');
    config.heroStory = revData.heroStory.trim();
  }
  if (revData.hours && revData.hours.trim()) {
    changesSummaryList.push('Updated Opening Hours');
    const rawHoursLines = revData.hours.split(/[\n|;]/).map(s => s.trim()).filter(Boolean);
    if (rawHoursLines.length) {
      config.hours = rawHoursLines.map(line => {
        const parts = line.split(/:\s*/);
        if (parts.length >= 2) {
          return { days: parts[0].trim(), time: parts.slice(1).join(':').trim() };
        }
        return { days: line, time: '' };
      });
    }
  }

  // 1b. Apply Custom Salon Photos (up to 6 photos uploaded in revision portal)
  if (Array.isArray(revData.salonPhotos) && revData.salonPhotos.length > 0) {
    const validUrls = revData.salonPhotos.map(p => (typeof p === 'string' ? p : (p && p.url) || '')).filter(Boolean);
    if (validUrls.length > 0) {
      config.images = config.images || {};
      if (validUrls[0]) config.images.hero = validUrls[0];
      if (validUrls[1]) config.images.biabFeature = validUrls[1];
      if (validUrls[2]) config.images.pedicureFeature = validUrls[2];
      const existingLookbook = Array.isArray(config.images.lookbook) ? config.images.lookbook : [];
      if (validUrls.length > 0 && existingLookbook.length > 0) {
        config.images.lookbook = existingLookbook.map((item, idx) => {
          const replacementUrl = validUrls[idx % validUrls.length];
          return replacementUrl ? { ...item, src: replacementUrl } : item;
        });
      }
      changesSummaryList.push(`Applied ${validUrls.length} uploaded salon photo(s)`);
    }
  }

  // 2. Apply Menu & Free-Form Notes / Admin Instructions via Gemini Multimodal Vision
  let updatedMenu = menu;
  const allMenuB64 = Array.isArray(menuImagesBase64) && menuImagesBase64.length > 0
    ? menuImagesBase64.filter(Boolean)
    : (menuImageBase64 ? [menuImageBase64] : []);
  const combinedMenuText = String(revData.menuText || revData.menuNotes || '').trim();
  const combinedFinalNotes = String(revData.notes || revData.finalNotes || '').trim();
  const cleanAdminInst = String(adminInstructions || '').trim();
  const hasAiWork = Boolean(combinedMenuText || combinedFinalNotes || cleanAdminInst || allMenuB64.length > 0);

  if (hasAiWork && geminiApiKey) {
    try {
      const parts = [
        {
          text: `You are the Lead Digital Atelier Engineer for WynnPages Australia (wynnpages.com.au).
We are finalizing a client's website revision round.
Your task is to analyze:
1) Any uploaded menu image(s) / PDF(s) (${allMenuB64.length} page(s) attached)
2) The client's menu revision notes & final launch notes
3) Any extra instructions from the Studio Admin

Return ONLY a valid JSON object with this exact structure (no markdown fences):
{
  "updatedMenu": [
    {
      "id": "biab",
      "category": "Category Title",
      "note": "Short category description",
      "items": [
        {
          "name": "Service Name",
          "duration": "60 mins",
          "price": "$85",
          "desc": "Short description of service craftsmanship",
          "badge": "Optional badge like Most Loved or Signature"
        }
      ]
    }
  ],
  "configPatches": {
    "salonName": "optional string if requested",
    "displayPhone": "optional string if requested",
    "address": "optional string if requested",
    "bookingUrl": "optional string if requested",
    "heroBadge": "optional string if requested",
    "heroHeadlinePrefix": "optional string if requested",
    "heroHeadlineItalic": "optional string if requested",
    "heroStory": "optional string if requested",
    "palette": "optional '01'|'02'|'03'|'04'|'05' if colour theme change requested",
    "instagramUrl": "optional string if requested",
    "facebookUrl": "optional string if requested",
    "hours": [{"days": "Mon - Fri", "time": "9:30am - 6:00pm"}]
  },
  "summary": "1-sentence summary of what was updated"
}

CRITICAL RULES:
- All prices MUST be in AUD (e.g. "$95", "$110", "$65").
- If multiple menu images are attached, read and merge ALL categories and services across all pages into "updatedMenu".
- If no menu changes were requested and no menu images are attached, keep the existing menu in "updatedMenu".
- Only include keys in "configPatches" that were explicitly requested in the client's final notes or Admin instructions.`
        }
      ];

      for (const b64Item of allMenuB64) {
        const isPdf = String(b64Item).includes('application/pdf');
        const mimeMatch = String(b64Item).match(/^data:([^;]+);base64,/);
        const mimeType = isPdf ? 'application/pdf' : ((mimeMatch && mimeMatch[1]) || 'image/jpeg');
        const cleanBase64 = String(b64Item).replace(/^data:[^;]+;base64,/, '');
        if (cleanBase64) {
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: cleanBase64
            }
          });
        }
      }

      parts.push({
        text: `CURRENT DEMO CONFIG:
${JSON.stringify({
  salonName: config.salonName,
  displayPhone: config.displayPhone,
  address: config.address,
  bookingUrl: config.bookingUrl,
  palette: config.palette,
  heroBadge: config.heroBadge,
  heroHeadlinePrefix: config.heroHeadlinePrefix,
  heroHeadlineItalic: config.heroHeadlineItalic,
  heroStory: config.heroStory,
  hours: config.hours,
  instagramUrl: config.instagramUrl,
  facebookUrl: config.facebookUrl
}, null, 2)}

CURRENT DEMO MENU DATA:
${JSON.stringify(menu, null, 2)}

CLIENT'S MENU REVISION REQUEST:
${combinedMenuText || (allMenuB64.length ? `Extract all services and prices from the ${allMenuB64.length} attached menu page(s).` : '(None)')}

CLIENT'S FINAL NOTES / SPECIAL INSTRUCTIONS:
${combinedFinalNotes || '(None)'}

STUDIO ADMIN EXTRA INSTRUCTIONS (HIGHEST PRIORITY):
${cleanAdminInst || '(None)'}`
      });

      const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash'];
      let geminiSuccess = false;
      let lastGeminiErrMsg = '';
      for (const modelName of modelsToTry) {
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              response_mime_type: 'application/json',
              temperature: 0.1
            }
          })
        });

        if (geminiRes.ok) {
          const gData = await geminiRes.json();
          const rawText = (gData?.candidates?.[0]?.content?.parts?.[0]?.text || '')
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
          if (rawText) {
            try {
              const parsed = JSON.parse(rawText);
              if (Array.isArray(parsed) && parsed.length) {
                updatedMenu = parsed;
                changesSummaryList.push(`Gemini AI (${modelName}) updated ${parsed.length} menu categories`);
                geminiSuccess = true;
                break;
              } else if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.updatedMenu) && parsed.updatedMenu.length) {
                  updatedMenu = parsed.updatedMenu;
                }
                if (parsed.configPatches && typeof parsed.configPatches === 'object') {
                  const cp = parsed.configPatches;
                  if (cp.salonName) config.salonName = String(cp.salonName).trim();
                  if (cp.displayPhone) {
                    config.displayPhone = String(cp.displayPhone).trim();
                    config.smsPhone = String(cp.displayPhone).trim();
                  }
                  if (cp.address) {
                    config.address = String(cp.address).trim();
                    config.mapsQuery = `${config.address}, Australia`;
                  }
                  if (cp.bookingUrl) config.bookingUrl = String(cp.bookingUrl).trim();
                  if (cp.heroBadge) config.heroBadge = String(cp.heroBadge).trim();
                  if (cp.heroHeadlinePrefix !== undefined) config.heroHeadlinePrefix = String(cp.heroHeadlinePrefix).trim();
                  if (cp.heroHeadlineItalic !== undefined) config.heroHeadlineItalic = String(cp.heroHeadlineItalic).trim();
                  if (cp.heroStory) config.heroStory = String(cp.heroStory).trim();
                  if (cp.palette && ['01', '02', '03', '04', '05'].includes(String(cp.palette))) {
                    config.palette = String(cp.palette);
                  }
                  if (cp.instagramUrl) config.instagramUrl = String(cp.instagramUrl).trim();
                  if (cp.facebookUrl) config.facebookUrl = String(cp.facebookUrl).trim();
                  if (cp.logoUrl) config.logoUrl = String(cp.logoUrl).trim();
                  if (Array.isArray(cp.hours) && cp.hours.length) {
                    config.hours = cp.hours;
                  }
                }
                changesSummaryList.push(parsed.summary || `Gemini AI (${modelName}) updated ${Array.isArray(updatedMenu) ? updatedMenu.length : 0} menu categories${allMenuB64.length ? ` (${allMenuB64.length} menu page(s) OCR'd)` : ''}`);
                geminiSuccess = true;
                break;
              }
            } catch (_) {}
          }
        } else {
          const errJson = await geminiRes.json().catch(() => null);
          lastGeminiErrMsg = (errJson && errJson.error && errJson.error.message) || `HTTP ${geminiRes.status}`;
        }
      }
      if (!geminiSuccess) {
        // Deterministic fallback parser for palette/price instructions when Gemini API is restricted or not configured
        const allDirectives = `${combinedMenuText}\n${combinedFinalNotes}\n${cleanAdminInst}`;
        const palMatch = allDirectives.match(/(?:palette|bảng\s*màu|màu\s*số)\s*#?\s*(0?[1-5])\b/i);
        if (palMatch) {
          const pNum = palMatch[1].padStart(2, '0');
          config.palette = pNum;
          changesSummaryList.push(`Switched palette to ${pNum}`);
        }
        if (allMenuB64.length > 0 && lastGeminiErrMsg.includes('blocked')) {
          changesSummaryList.push('⚠️ Lưu ý: Key Google hiện tại chỉ bật Places API (chưa bật Gemini Vision OCR). Hãy dán Gemini API Key (từ aistudio.google.com/apikey) vào mục ⚙️ Cấu hình API để AI tự động đọc chữ từ ảnh Menu!');
        } else if (combinedMenuText && updatedMenu) {
          changesSummaryList.push('Applied text menu notes');
        }
      }
    } catch (gErr) {
      if (combinedMenuText && updatedMenu) {
        changesSummaryList.push('Applied fallback price tweaks to menu');
      }
    }
  } else if (hasAiWork && combinedMenuText && updatedMenu) {
    changesSummaryList.push('Applied text menu directives');
  }

  const updatedHtml = updateHtmlWithConfigAndMenu(currentHtml, config, updatedMenu);
  return {
    ok: true,
    updatedHtml,
    changesSummary: changesSummaryList.join(' • ') || 'Config updated successfully'
  };
}

function buildAiPromptForClient(c) {
  const slug = c.demoSlug || slugifyName(c.businessName || c.name || c.id);
  const promptLines = [
    `=== WYNNPAGES ATELIER — ANTIGRAVITY PROJECT BRIEF ===`,
    `Project Slug: ${slug}`,
    `Local Workspace Folder: clients/${slug}/`,
    `Live Demo Subdomain: https://${slug}.wynnpages.com.au`,
    `Client / Account Name: ${c.name || 'N/A'}`,
    `Business Name (Trading Name): ${c.businessName || c.name || 'N/A'}`,
    `Client Email: ${c.email || 'N/A'}`,
    `Client Mobile (SMS): ${c.phone || 'N/A'}`,
    `Display Phone (For Website): ${c.displayPhone || c.phone || 'N/A'}`,
    `Business Address / Service Area: ${c.businessAddress || 'N/A'}`,
    `Social Media & Booking Links: ${c.socialLinks || 'N/A'}`,
    `Brief Type: ${c.briefType || 'organic'} | Stage: ${c.stage || 'brief_completed'}`,
    `Industry / Niche: ${c.industry || 'Nail Salon / Beauty Atelier'}`,
    `Client Color Notes: ${c.brandColors || 'Select best match from Haute Couture Palettes 01–05'}`,
    `Reference Websites / Vibe Links: ${c.vibeLinks || 'N/A'}`,
    `Domain Info: Existing=${c.existingDomain || 'N/A'} | Desired=${c.desiredDomains || 'N/A'} | Official=${c.liveUrl || 'N/A'}`,
    `Uploaded Logo: ${c.logoFileName || 'None (Use Tier A Embossed Gold Wax Monogram Seal)'}`,
    `Uploaded Menu / Price List: ${c.menuFileName || 'None (Use curated Australian AUD sample menu)'}`,
    `Uploaded Photos: ${c.photosFileName || c.hasPhotos || 'None (Use Atelier Fine-Art Oil + Gold-Leaf Vault)'}`
  ];

  if (c.googleRating || c.googleReviewCount || c.googleLeadType) {
    promptLines.push(
      `Google Maps Intelligence: Rating ⭐ ${c.googleRating || 'N/A'} (${c.googleReviewCount || 0} reviews) | Lead Status: ${c.googleLeadType || 'N/A'}`
    );
  }

  if (c.openingHours) {
    promptLines.push(
      `=====================================================`,
      `VERIFIED LOCAL OPENING HOURS (GOOGLE MAPS):`,
      c.openingHours
    );
  }

  if (c.customerReviews) {
    promptLines.push(
      `=====================================================`,
      `TOP 3 REAL 5-STAR CUSTOMER REVIEWS (GOOGLE MAPS):`,
      c.customerReviews
    );
  }

  if (c.placesPhotos && Array.isArray(c.placesPhotos) && c.placesPhotos.length > 0) {
    const photoUrls = c.placesPhotos.slice(0, 6).map((ph, idx) => `Photo ${idx + 1}: /api/places-photo?ref=${encodeURIComponent(ph)}&maxWidth=800`).join('\n');
    promptLines.push(
      `=====================================================`,
      `GOOGLE MAPS REAL CLIENT PHOTOS (${c.placesPhotos.length} captured):`,
      photoUrls,
      ``,
      `MANDATORY ARTWORK DIRECTIVE — CÁCH 2: AI FINE-ART TRANSLATION (Biến ảnh thật thành Tranh Sơn Dầu):`,
      `1. KHÔNG dán ảnh chụp điện thoại thô của tiệm vào website làm mất tính Haute Couture.`,
      `2. Lấy bố cục, kiểu móng (BIAB, French, Almond), dáng tay, góc tiệm thực tế từ các ảnh trên làm mẫu chuẩn (composition reference).`,
      `3. Dùng subagent image-generator dịch sang Tranh Sơn Dầu Pháp (French Fine-Art Oil Painting) kèm dát vàng 24k (gold leaf foil accents), nét cọ sơn dầu nổi (impasto), ánh sáng tự nhiên trên nền vải thô lanh (linen canvas).`,
      `4. Bộ màu tuân thủ 100% Haute Couture Palette ${c.demoPalette || '01'} (${c.brandColors || 'Terracotta Gold'}). Xuất các ảnh vào clients/${slug}/assets/ để gắn vào index.html.`
    );
  }

  if (c.instagramUrl || c.facebookUrl) {
    promptLines.push(
      `Social Media Detected: Instagram: ${c.instagramUrl || 'N/A'} | Facebook: ${c.facebookUrl || 'N/A'}`
    );
  }

  if (c.parkingInfo) {
    promptLines.push(
      `Parking & Boutique Access: ${c.parkingInfo}`
    );
  }

  promptLines.push(
    `=====================================================`,
    `ANTIGRAVITY EXECUTION WORKFLOW:`,
    `1. Pull or initialize the local client workspace: \`node scripts/atelier-sync.mjs pull ${slug}\` (this also downloads any uploaded menu/logo into \`clients/${slug}/_client_uploads/\`).`,
    `2. Read \`clients/GEMINI.md\` and \`clients/${slug}/ATELIER_MANIFEST.md\`. Strictly enforce the WynnPages Bespoke Oil-Painting & Gold-Leaf aesthetic, 5 fixed Haute Couture Palettes (01 Terracotta & Gold, 02 Rose Silk, 03 Botanical Sage, 04 Espresso Cashmere, 05 Coastal Pearl), editorial Cormorant Garamond italic heading accents, and ZERO emojis.`,
    `3. Customize \`clients/${slug}/index.html\` (\`window.ATELIER_CONFIG\` & \`window.SALON_MENU_DATA\`). ${c.openingHours ? 'Use the REAL trading hours in the Visit & Hours section. ' : ''}${c.customerReviews ? 'Weave the REAL 5-star customer reviews into the Testimonials / Word of Mouth section! ' : ''}Transcribe real menu prices from \`_client_uploads/\` if present.`,
    `4. Push live immediately when done: \`node scripts/atelier-sync.mjs push ${slug}\` and verify \`https://${slug}.wynnpages.com.au\`.`
  );

  return promptLines.join('\n');
}

function slugifyName(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function formatCustomerRecord(cust) {
  if (!cust || cust.deleted) return null;
  if (!cust.metadata && typeof cust.demoSlug === 'string' && typeof cust.paymentStatus === 'string') {
    return cust;
  }
  const m = cust.metadata || {};
  const rawStage = m.stage || (m.brief_status === 'completed' ? 'brief_completed' : 'outbound_pending');
  const flowType = m.flow_type || (rawStage.startsWith('outbound_') ? 'outbound' : 'inbound');
  const hasExplicitPaymentEvidence =
    m.payment_status === 'paid' ||
    rawStage === 'outbound_paid' ||
    rawStage === 'launched' ||
    (flowType === 'inbound' &&
      rawStage !== 'checkout_started' &&
      rawStage !== 'unpaid' &&
      m.payment_status !== 'unpaid' &&
      (Boolean(m.checkout_session_id) || m.welcome_sent === 'true' || m.brief_status === 'completed'));
  const paymentStatus = m.payment_status === 'paid'
    ? 'paid'
    : (m.payment_status === 'unpaid' ? 'unpaid' : (hasExplicitPaymentEvidence ? 'paid' : 'unpaid'));
  const displayName = m.business_name || cust.name || m.customer_name || '';
  const demoSlug = m.demo_slug || slugifyName(displayName) || cust.id.toLowerCase();
  const brandedDemoUrl = `https://${demoSlug}.wynnpages.com.au`;
  const record = {
    id: cust.id,
    name: cust.name || m.customer_name || m.business_name || '',
    businessName: m.business_name || '',
    demoSlug,
    brandedDemoUrl,
    email: cust.email || m.customer_email || '',
    phone: cust.phone || m.customer_phone || m.display_phone || '',
    displayPhone: m.display_phone || cust.phone || m.customer_phone || '',
    businessAddress: m.business_address || '',
    socialLinks: m.social_links || '',
    flowType,
    paymentStatus,
    stage: rawStage,
    briefStatus: m.brief_status || 'pending',
    briefType: m.brief_type || 'organic',
    industry: m.industry || '',
    brandColors: m.brand_colors || '',
    vibeLinks: m.vibe_links || '',
    hasDomain: m.has_domain || '',
    existingDomain: m.existing_domain || '',
    desiredDomains: m.desired_domains || '',
    domainAccessNotes: m.domain_access_notes || '',
    dnsMode: m.dns_mode || '',
    cfNameservers: m.cf_nameservers || '',
    cfZoneStatus: m.cf_zone_status || '',
    logoFileId: m.logo_file_id || '',
    logoFileName: m.logo_file_name || '',
    logoDriveUrl: m.logo_drive_url || '',
    menuFileId: m.menu_file_id || '',
    menuFileName: m.menu_file_name || '',
    menuDriveUrl: m.menu_drive_url || '',
    hasPhotos: m.has_photos || '',
    photosFileId: m.photos_file_id || '',
    photosFileName: m.photos_file_name || '',
    photosDriveUrl: m.photos_drive_url || '',
    driveFolderUrl: m.drive_folder_url || '',
    demoUrl: m.demo_url || brandedDemoUrl,
    demoSourceType: m.demo_source_type || 'url',
    demoPalette: m.demo_palette || '01',
    demoFilesCount: Number(m.demo_files_count || 0),
    demoUploadedAt: m.demo_uploaded_at || '',
    liveUrl: m.live_url || '',
    googlePlaceId: m.google_place_id || '',
    googleMapsUri: m.google_maps_uri || '',
    googleRating: m.google_rating || '',
    googleReviewCount: m.google_review_count || '',
    googleLeadType: m.google_lead_type || '',
    googleWebsiteUri: m.google_website_uri || '',
    openingHours: m.opening_hours || '',
    customerReviews: m.customer_reviews || '',
    domainDelegated: m.domain_delegated === 'true',
    domainDelegatedAt: m.domain_delegated_at || '',
    domainProvider: m.domain_provider || '',
    checkoutSessionId: m.checkout_session_id || '',
    welcomeSent: m.welcome_sent || 'false',
    lastSmsLog: m.last_sms_log || '',
    lastEmailLog: m.last_email_log || '',
    demoSentAt: m.demo_sent_at || '',
    reminderCount: Number(m.reminder_count || 0),
    dealStatus: m.deal_status || 'standard',
    dealActivatedAt: m.deal_activated_at || '',
    dealExpiresAt: m.deal_expires_at || '',
    nurtureStep: m.nurture_step || '',
    nurtureAutoEnabled: m.nurture_auto_enabled !== 'false',
    instagramUrl: m.instagram_url || '',
    facebookUrl: m.facebook_url || '',
    placesPhotos: (() => {
      try {
        if (!m.places_photos) return [];
        const parsed = typeof m.places_photos === 'string' ? JSON.parse(m.places_photos) : m.places_photos;
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        const matches = String(m.places_photos || '').match(/places\/[^",\s\]]+/g);
        return matches || [];
      }
    })(),
    parkingInfo: m.parking_info || '',
    editorialSummary: m.editorial_summary || '',
    launchedAt: m.launched_at || '',
    fbPitchedAt: m.fb_pitched_at || '',
    channelMode: m.channel_mode || (m.fb_pitched_at && !m.demo_sent_at ? 'facebook' : 'sms'),
    turboTestMode: m.turbo_test_mode === 'true',
    sequenceStartedAt: m.sequence_started_at || m.demo_sent_at || m.fb_pitched_at || '',
    step1SentAt: m.step1_sent_at || m.demo_sent_at || m.fb_pitched_at || '',
    step2SentAt: m.step2_sent_at || '',
    step3SentAt: m.step3_sent_at || (m.deal_status === 'flash_deal' ? (m.deal_activated_at || '') : ''),
    step4SentAt: m.step4_sent_at || '',
    step5LockedAt: m.step5_locked_at || (m.deal_status === 'expired' ? (m.deal_expires_at || 'true') : ''),
    fbDueStep: m.fb_due_step || '',
    fbAlertedSteps: m.fb_alerted_steps || '',
    demoViewCount: Number(m.demo_view_count || 0),
    demoFirstViewedAt: m.demo_first_viewed_at || '',
    demoLastViewedAt: m.demo_last_viewed_at || '',
    demoViewerDevice: m.demo_viewer_device || '',
    revisionStatus: m.revision_status || 'none',
    revisionSubmittedAt: m.revision_submitted_at || '',
    revisionAppliedAt: m.revision_applied_at || '',
    revisionSummary: m.revision_summary || '',
    revisionMenuFileName: m.revision_menu_file_name || '',
    revisionMenuFileUrl: m.revision_menu_file_url || '',
    revisionPhotosFileName: m.revision_photos_file_name || '',
    submittedAt: m.submitted_at || new Date((cust.created && cust.created < 1e11 ? cust.created * 1000 : (cust.created || Date.now()))).toISOString(),
    created: cust.created ? (cust.created < 1e11 ? cust.created * 1000 : cust.created) : Date.now(),
    metadata: m
  };
  record.aiPrompt = buildAiPromptForClient(record);
  return record;
}

async function findCustomerBySlugOrId(slugOrId, stripeSecretKey) {
  if (!slugOrId || !stripeSecretKey) return null;
  const cleanSlug = slugifyName(slugOrId);
  if (slugOrId.startsWith('cus_')) {
    const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(slugOrId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
    });
    if (res.ok) {
      const rawCust = await res.json().catch(() => null);
      if (!rawCust || rawCust.deleted) return null;
      return formatCustomerRecord(rawCust);
    }
    return null;
  }
  const listRes = await fetch('https://api.stripe.com/v1/customers?limit=100', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
  });
  if (!listRes.ok) return null;
  const data = await listRes.json().catch(() => ({}));
  const list = (data.data || []).filter(c => c && !c.deleted).map(formatCustomerRecord).filter(Boolean);
  return list.find(c =>
    c.demoSlug === cleanSlug ||
    slugifyName(c.businessName) === cleanSlug ||
    slugifyName(c.name) === cleanSlug ||
    c.id.toLowerCase() === slugOrId.toLowerCase()
  ) || null;
}

function extractCleanHost(rawUrlOrDomain) {
  if (!rawUrlOrDomain || typeof rawUrlOrDomain !== 'string') return '';
  return rawUrlOrDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/^www\./i, '')
    .replace(/:\d+$/, '')
    .trim();
}

async function findCustomerByLiveDomain(hostname, stripeSecretKey) {
  if (!hostname || !stripeSecretKey) return null;
  const targetRoot = extractCleanHost(hostname);
  if (!targetRoot || targetRoot.endsWith('wynnpages.com.au')) return null;
  const listRes = await fetch('https://api.stripe.com/v1/customers?limit=100', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
  });
  if (!listRes.ok) return null;
  const data = await listRes.json().catch(() => ({}));
  const list = (data.data || []).map(formatCustomerRecord);
  return list.find(c => {
    const liveHost = extractCleanHost(c.liveUrl);
    const existHost = extractCleanHost(c.existingDomain);
    const desiredHost = extractCleanHost(c.desiredDomains);
    return liveHost === targetRoot || existHost === targetRoot || desiredHost === targetRoot;
  }) || null;
}

function buildCleanLiveHtml(client, origin = '') {
  const bizName = (client && (client.businessName || client.name)) || 'Official Website';
  const safeBiz = bizName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let rawDemo = (client && client.demoUrl) || 'https://wynnpages.com.au';
  if (rawDemo && !rawDemo.startsWith('http')) rawDemo = 'https://' + rawDemo;
  const ogImg = origin ? `${origin}/og-share.jpg` : '/og-share.jpg';
  const canon = origin ? `${origin}/` : '/';
  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeBiz}</title>
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${canon}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${safeBiz}">
  <meta property="og:url" content="${canon}">
  <meta property="og:image" content="${ogImg}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeBiz}">
  <meta name="twitter:image" content="${ogImg}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #f6f1e8; }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: #f6f1e8; -webkit-overflow-scrolling: touch; }
  </style>
</head>
<body>
  <iframe src="${rawDemo.replace(/"/g, '&quot;')}" title="${safeBiz}" allow="fullscreen"></iframe>
</body>
</html>`;
}

async function serveLiveClientSite(liveClient, request, url) {
  let rawDemo = (liveClient && liveClient.demoUrl) || 'https://wynnpages.com.au';
  if (!rawDemo.startsWith('http')) rawDemo = 'https://' + rawDemo;

  try {
    const targetUrl = new URL(url.pathname + url.search, rawDemo);
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.set('Host', new URL(rawDemo).host);
    proxyHeaders.delete('cf-connecting-ip');
    proxyHeaders.delete('x-real-ip');

    const res = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'follow'
    });

    if (res.status < 500) {
      const responseHeaders = new Headers(res.headers);
      responseHeaders.delete('x-frame-options');
      responseHeaders.delete('content-security-policy');
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders
      });
    }
  } catch (err) {
    // Graceful fallback to full-screen clean container
  }

  return new Response(buildCleanLiveHtml(liveClient), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function getMimeType(filePath) {
  const ext = (filePath || '').split('.').pop().toLowerCase();
  const types = {
    'html': 'text/html; charset=utf-8',
    'htm': 'text/html; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'js': 'application/javascript; charset=utf-8',
    'mjs': 'application/javascript; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'pdf': 'application/pdf'
  };
  return types[ext] || 'application/octet-stream';
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Lightweight contact & social scraper from a business's public website
async function extractSocialAndContactFromWebsite(websiteUrl) {
  if (!websiteUrl || !websiteUrl.startsWith('http')) return {};
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2600);
    const res = await fetch(websiteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeoutId);
    if (!res.ok) return {};
    const text = (await res.text()).slice(0, 180000);

    let instagram = '';
    let facebook = '';
    let email = '';
    let booking = '';

    const igMatch = text.match(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,30})/i);
    if (igMatch && !['p', 'explore', 'reel', 'direct', 'stories'].includes(igMatch[1].toLowerCase())) {
      instagram = `https://instagram.com/${igMatch[1]}`;
    }

    const fbMatch = text.match(/https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9_.]{3,50})/i);
    if (fbMatch && !['sharer', 'share', 'policies', 'dialog', 'privacy'].includes(fbMatch[1].toLowerCase())) {
      facebook = `https://facebook.com/${fbMatch[1]}`;
    }

    const mailtoMatch = text.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (mailtoMatch) {
      const em = mailtoMatch[1].toLowerCase();
      if (!/(sentry|wixpress|example|domain|schema|cloudflare|wix\.com)/.test(em)) {
        email = em;
      }
    }
    if (!email) {
      const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/i);
      if (emailMatch) {
        const em = emailMatch[1].toLowerCase();
        if (!/(sentry|wixpress|example|domain|schema|cloudflare|wix\.com|jpg|png|webp)/.test(em)) {
          email = em;
        }
      }
    }

    const bkMatch = text.match(/(https?:\/\/(?:www\.)?(?:[a-zA-Z0-9-]+\.)?(?:fresha\.com|timely\.com|square\.site|booksy\.com|heygoldie\.com|vagaro\.com|ovatu\.com)[^\s"'>]+)/i);
    if (bkMatch) {
      booking = bkMatch[1];
    }

    return { instagram, facebook, email, booking };
  } catch (_) {
    return {};
  }
}

function buildExpiredDemoHtml(client) {
  const bizName = (client && (client.businessName || client.name)) || 'Your Business';
  const demoSlug = (client && client.demoSlug) || slugifyName(bizName);
  const demoUrl = (client && (client.demoUrl || client.brandedDemoUrl)) || (demoSlug ? `https://${demoSlug}.wynnpages.com.au` : '');
  const clientPhone = (client && (client.phone || client.displayPhone)) || '';
  const clientEmail = (client && client.email) || '';
  const clientAddress = (client && client.businessAddress) || '';
  const clientId = (client && client.id) || '';

  const expDateStr = client && client.dealExpiresAt ? new Date(client.dealExpiresAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }) : 'recently';

  const mailSubject = `Reactivate Website Preview — ${bizName}`;
  const specLines = [
    `• Business Name: ${bizName}`,
    demoUrl ? `• Preview Link: ${demoUrl}` : '',
    clientPhone ? `• Phone: ${clientPhone}` : '',
    clientEmail ? `• Email: ${clientEmail}` : '',
    clientAddress ? `• Address: ${clientAddress}` : '',
    clientId ? `• Studio Reference: ${clientId}` : ''
  ].filter(Boolean).join('\n');

  const mailBody = [
    `Hi WynnPages Studio,`,
    ``,
    `I am the owner of ${bizName} and would love to unlock and reactivate our bespoke website preview ($599 AUD flat, 100% ownership, zero monthly fees).`,
    ``,
    `--- MY BUSINESS DETAILS ---`,
    specLines,
    `---------------------------`,
    ``,
    `Please reactivate our preview link and send through the next steps.`,
    ``,
    `Warm regards,`,
    bizName
  ].join('\n');

  const mailtoHref = `mailto:hello@wynnpages.com.au?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Demo Preview Archived — WynnPages Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #fbf9f4;
      color: #2b2723;
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: radial-gradient(#d49b28 0.7px, transparent 0.7px);
      background-size: 24px 24px;
      opacity: 0.18;
      pointer-events: none;
    }
    .expired-card {
      position: relative;
      background: #ffffff;
      border: 1px solid #e7dfcc;
      border-radius: 28px;
      max-width: 600px;
      width: 100%;
      padding: 44px 34px;
      text-align: center;
      box-shadow: 0 25px 60px -15px rgba(150, 67, 43, 0.12), 0 0 0 1px rgba(212, 155, 40, 0.2);
    }
    .atelier-seal {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      background: linear-gradient(135deg, #96432b 0%, #7d3520 100%);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 24px rgba(150, 67, 43, 0.35);
      border: 1px solid rgba(251, 222, 185, 0.4);
    }
    .atelier-seal img { width: 36px; height: 36px; object-fit: contain; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
      padding: 4px 14px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 18px;
    }
    h1 {
      font-family: 'Cormorant Garamond', Georgia, serif;
      font-size: 32px;
      font-weight: 700;
      line-height: 1.2;
      color: #1c1917;
      margin-bottom: 12px;
    }
    h1 em {
      font-style: italic;
      color: #96432b;
      font-weight: 600;
    }
    .client-target {
      font-size: 13.5px;
      color: #78716c;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .client-target strong {
      color: #1c1917;
      font-weight: 800;
    }
    .expired-desc {
      font-size: 13px;
      line-height: 1.65;
      color: #57534e;
      margin-bottom: 28px;
      padding: 0 10px;
    }
    .btn-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 10px;
    }
    @media (min-width: 560px) {
      .btn-group {
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
      }
    }
    .btn-unlock {
      width: 100%;
      background: linear-gradient(135deg, #15803d 0%, #166534 100%);
      color: #ffffff;
      border: 1px solid rgba(187, 247, 208, 0.35);
      padding: 15px 24px;
      border-radius: 14px;
      font-family: inherit;
      font-weight: 800;
      font-size: 13.5px;
      line-height: 1.25;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 12px 24px rgba(22, 101, 52, 0.26);
      transition: all 0.2s;
      margin-bottom: 4px;
    }
    .btn-unlock:hover:not(:disabled) {
      transform: translateY(-1.5px);
      box-shadow: 0 16px 30px rgba(22, 101, 52, 0.36);
    }
    .btn-unlock:disabled {
      opacity: 0.75;
      cursor: wait;
    }
    .unlock-status {
      font-size: 12px;
      font-weight: 600;
      color: #166534;
      margin-top: 8px;
      min-height: 18px;
    }
    .btn-primary {
      background: linear-gradient(135deg, #96432b 0%, #7d3520 100%);
      color: #ffffff;
      padding: 13px 22px;
      border-radius: 14px;
      font-weight: 700;
      font-size: 13px;
      line-height: 1.2;
      white-space: nowrap;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 10px 20px rgba(150, 67, 43, 0.28);
      transition: all 0.2s;
    }
    .btn-primary:hover {
      transform: translateY(-1.5px);
      box-shadow: 0 14px 28px rgba(150, 67, 43, 0.4);
    }
    .btn-secondary {
      background: #fbf9f4;
      color: #44403c;
      border: 1px solid #dcd3be;
      padding: 13px 20px;
      border-radius: 14px;
      font-weight: 600;
      font-size: 13px;
      line-height: 1.2;
      white-space: nowrap;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      background: #f5eedf;
      border-color: #c9bc9d;
    }
    .footer-note {
      font-size: 11px;
      color: #a8a29e;
      margin-top: 26px;
    }
  </style>
</head>
<body>
  <div class="expired-card">
    <div class="atelier-seal">
      <img src="https://wynnpages.com.au/assets/favicon-light.png" alt="WynnPages Atelier">
    </div>
    <div class="status-pill">
      <span>●</span> Demo Preview Archived
    </div>
    <h1>This Bespoke Website Preview Has <em>Expired</em></h1>
    <p class="client-target">Prepared exclusively for: <strong>${bizName}</strong></p>
    <p class="expired-desc">
      The preview hold and exclusive studio offer for <strong>${bizName}</strong> concluded on <strong>${expDateStr}</strong>.<br><br>
      To protect brand exclusivity and keep every client design private on the <strong>WynnPages Studio Australian High-Speed Network</strong>, this website preview has been moved to our private archive.
      If you are the business owner, you can unlock <strong>48-hour live preview access</strong> instantly with one click below, or email our studio to customise and claim this website ($599 AUD flat, 100% ownership, zero monthly retainers).
    </p>
    <button type="button" id="btn-self-unlock-48h" class="btn-unlock">
      <span>🔓 I'm the Business Owner — Unlock 48-Hour Preview</span>
    </button>
    <div id="unlock-status-msg" class="unlock-status" aria-live="polite"></div>
    <div class="btn-group">
      <a href="${mailtoHref}" class="btn-primary">
        <span>✉️ Email Studio to Reactivate</span>
      </a>
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="btn-secondary">
        <span>Visit WynnPages Studio ↗</span>
      </a>
    </div>
    <p class="footer-note">WynnPages Studio — Australian Bespoke Web Atelier • Flat $599 AUD • Zero Monthly Retainers</p>
  </div>
  <script>
    (function() {
      var btn = document.getElementById('btn-self-unlock-48h');
      var statusEl = document.getElementById('unlock-status-msg');
      if (!btn) return;
      var slug = ${JSON.stringify(demoSlug)};
      var cid = ${JSON.stringify(clientId)};
      var biz = ${JSON.stringify(bizName)};
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Unlocking Your 48-Hour Preview...</span>';
        if (statusEl) statusEl.textContent = 'Restoring private preview access on WynnPages Australian Network...';
        fetch('/api/track?slug=' + encodeURIComponent(slug || '') + '&type=self_unlock_48h', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slug: slug,
            clientId: cid,
            businessName: biz,
            eventType: 'self_unlock_48h'
          })
        })
          .then(function(r) { return r.json().catch(function() { return { ok: r.ok }; }); })
          .then(function(data) {
            if (data && data.ok !== false) {
              btn.innerHTML = "<span>✅ Unlocked for 48 Hours! Loading Preview...</span>";
              if (statusEl) statusEl.textContent = "Success! Redirecting to your live interactive website preview...";
              setTimeout(function() {
                var u = new URL(window.location.href);
                u.searchParams.set("unlocked", String(Date.now()));
                window.location.replace(u.toString());
              }, 350);
            } else {
              btn.disabled = false;
              btn.innerHTML = "<span>🔓 I'm the Business Owner — Unlock 48-Hour Preview</span>";
              if (statusEl) statusEl.textContent = (data && data.error) || "Could not auto-unlock. Please click Email Studio below.";
            }
          })
          .catch(function() {
            var u = new URL(window.location.href);
            u.searchParams.set("unlocked", String(Date.now()));
            window.location.replace(u.toString());
          });
      });
    })();
  </script>
</body>
</html>`;
}

function buildDealTopRibbonHtml(client) {
  const bizName = (client && (client.businessName || client.name)) || 'Your Business';
  const cid = (client && client.id) || '';
  const email = (client && client.email) || '';
  const claimHref = `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&deal=flash50&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}`;

  return `
  <style>
    .wynn-deal-top-bar {
      position: sticky;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999990;
      background: linear-gradient(90deg, #181512 0%, #2f1912 50%, #181512 100%);
      border-bottom: 1.5px solid rgba(232, 185, 72, 0.85);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 18px rgba(232, 185, 72, 0.3);
      color: #f6f1e8;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 9px 16px;
      font-size: 12px;
      box-sizing: border-box;
      width: 100%;
    }
    .wynn-deal-top-container {
      max-width: 1280px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .wynn-deal-top-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex-wrap: wrap;
    }
    .wynn-deal-top-badge {
      background: linear-gradient(135deg, #e8b948 0%, #d49b28 100%);
      color: #1c1917;
      font-weight: 800;
      font-size: 10px;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      border-radius: 6px;
      flex-shrink: 0;
      text-transform: uppercase;
      box-shadow: 0 2px 8px rgba(232, 185, 72, 0.35);
    }
    .wynn-deal-top-text {
      color: #f6f1e8;
      font-size: 12px;
      font-weight: 500;
    }
    .wynn-deal-top-text strong {
      color: #fbdeb9;
      font-weight: 800;
    }
    .wynn-deal-top-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .wynn-deal-top-cd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      font-size: 11px;
      color: #fbdeb9;
      background: rgba(232, 185, 72, 0.14);
      border: 1px solid rgba(232, 185, 72, 0.4);
      padding: 3px 8px;
      border-radius: 8px;
      white-space: nowrap;
    }
    .wynn-deal-top-cd strong {
      color: #ffffff;
      font-weight: 800;
    }
    .wynn-deal-top-cta {
      background: linear-gradient(135deg, #b83a24 0%, #d4452a 100%);
      color: #ffffff;
      padding: 5px 12px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 800;
      font-size: 11px;
      border: 1px solid rgba(232, 185, 72, 0.55);
      white-space: nowrap;
      transition: transform 0.15s ease;
    }
    .wynn-deal-top-cta:hover {
      transform: translateY(-1px);
    }
    @media (max-width: 768px) {
      .wynn-deal-top-bar { display: none !important; }
    }
  </style>
  <aside class="wynn-deal-top-bar" id="wynn-deal-top-bar" aria-label="Special Sponsorship Offer">
    <div class="wynn-deal-top-container">
      <div class="wynn-deal-top-left">
        <span class="wynn-deal-top-badge">⚡ 50% OFF FLASH DEAL</span>
        <span class="wynn-deal-top-text">Exclusive Sponsorship for <strong>${bizName}</strong>: <strong>$299 AUD</strong> (Save $300 AUD)</span>
      </div>
      <div class="wynn-deal-top-right">
        <span class="wynn-deal-top-cd">⏳ Ends in: <strong id="top-bar-cd-display">--:--:--</strong></span>
        <a href="${claimHref}" class="wynn-deal-top-cta">Claim 50% Deal &rarr;</a>
      </div>
    </div>
  </aside>
  `;
}

function buildClaimBarSnippet(client) {
  const rawBiz = String((client && (client.businessName || client.name)) || 'Your Business').trim();
  const bizName = (rawBiz === rawBiz.toLowerCase()) ? rawBiz.replace(/\b\w/g, (c) => c.toUpperCase()) : rawBiz;
  const cid = (client && client.id) || '';
  const email = (client && client.email) || '';
  const isPaid = Boolean(client && (
    client.paymentStatus === 'paid' ||
    client.stage === 'outbound_paid' ||
    client.stage === 'launched' ||
    client.stage === 'site_launched'
  ));

  // Check Flash Deal 50% (only when unpaid)
  let isFlashDeal = false;
  let expiresTimestamp = 0;
  if (!isPaid && client && client.dealStatus === 'flash_deal' && client.dealExpiresAt) {
    expiresTimestamp = new Date(client.dealExpiresAt).getTime();
    if (expiresTimestamp > Date.now()) {
      isFlashDeal = true;
    }
  }

  const claimHref = isFlashDeal
    ? `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&deal=flash50&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}`
    : `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}`;

  const revisionHref = `https://wynnpages.com.au/revision?client_id=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}`;

  const btnLabel = isFlashDeal
    ? `Claim Website — $299 AUD (Save 50%)`
    : `Claim This Website — $599 AUD`;

  return `
  <style>
    .claim-bar {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%) translateY(0);
      z-index: 999999;
      width: calc(100% - 28px);
      max-width: 820px;
      background: linear-gradient(135deg, rgba(54, 32, 23, 0.72) 0%, rgba(38, 22, 16, 0.76) 100%) !important;
      backdrop-filter: blur(28px) saturate(190%) !important;
      -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
      border: 1px solid rgba(235, 192, 92, 0.44) !important;
      border-radius: 22px;
      padding: 22px 20px 14px 20px;
      box-shadow: 0 22px 50px -10px rgba(28, 17, 12, 0.38), 0 4px 16px rgba(43, 25, 18, 0.20), inset 0 1px 0 rgba(255, 248, 236, 0.28), inset 0 -1px 0 rgba(212, 155, 40, 0.16) !important;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      color: #f6f1e8;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-sizing: border-box;
      overflow: visible;
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
    }
    .claim-bar.is-collapsed {
      transform: translateX(-50%) translateY(calc(100% + 48px));
      opacity: 0;
      pointer-events: none;
    }
    .claim-bar.claimed-active {
      border: 1.5px solid rgba(52, 211, 153, 0.48) !important;
      background: rgba(16, 31, 24, 0.62) !important;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(167, 243, 208, 0.25), 0 0 28px rgba(16, 185, 129, 0.18) !important;
    }
    .claim-collapse-btn {
      position: absolute;
      top: 6px;
      left: 50%;
      transform: translateX(-50%);
      border: none;
      background: transparent;
      padding: 2px 16px;
      margin-bottom: 6px;
      color: #ffffff;
      opacity: 0.65;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      cursor: pointer;
      transition: opacity 0.18s ease, transform 0.18s ease;
      z-index: 5;
    }
    .claim-collapse-btn:hover {
      opacity: 1;
      transform: translateX(-50%) translateY(1px);
    }
    .claim-restore-tab {
      position: fixed;
      left: 50%;
      bottom: calc(14px + env(safe-area-inset-bottom, 0px));
      transform: translateX(-50%) translateY(16px);
      z-index: 999998;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      background: linear-gradient(135deg, rgba(54, 32, 23, 0.74) 0%, rgba(38, 22, 16, 0.78) 100%) !important;
      backdrop-filter: blur(28px) saturate(190%) !important;
      -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
      color: rgba(255, 255, 255, 0.96);
      border: 1px solid rgba(235, 192, 92, 0.44) !important;
      border-radius: 9999px;
      padding: 8px 16px;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      white-space: nowrap;
      box-shadow: 0 20px 48px -12px rgba(28, 17, 12, 0.38), 0 4px 16px rgba(43, 25, 18, 0.20), inset 0 1px 0 rgba(255, 248, 236, 0.28), inset 0 -1px 0 rgba(212, 155, 40, 0.16) !important;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .claim-restore-tab:hover {
      background: linear-gradient(135deg, rgba(72, 43, 30, 0.84) 0%, rgba(52, 31, 22, 0.86) 100%) !important;
      border-color: rgba(235, 192, 92, 0.62) !important;
      color: #ffffff;
    }
    .claim-restore-tab.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    .claim-restore-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: #C85A32;
      box-shadow: 0 0 8px rgba(200, 90, 50, 0.95);
      flex-shrink: 0;
    }
    .claim-restore-price {
      color: #f3a683;
      font-weight: 800;
    }
    /* Merged floating Call Salon pill into sticky Book Visit header button */
    #atelier-float-dock {
      display: none !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Header Brand Identity & Book Visit CTA Mobile Responsiveness */
    #atelier-nav-shell {
      min-width: 0 !important;
    }
    #atelier-nav-shell > a:first-child {
      min-width: 0 !important;
      flex: 1 1 auto !important;
      overflow: hidden !important;
    }
    #atelier-nav-shell > a:first-child > div:last-child {
      min-width: 0 !important;
      flex: 1 1 auto !important;
      overflow: hidden !important;
    }
    #nav-salon-name {
      display: block !important;
      min-width: 0 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 100% !important;
      font-size: clamp(15px, 4.2vw, 22px) !important;
      line-height: 1.15 !important;
    }
    #nav-salon-sub {
      display: block !important;
      min-width: 0 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      max-width: 100% !important;
    }
    #atelier-header button[data-open-booking],
    header button[data-open-booking] {
      white-space: nowrap !important;
      flex-shrink: 0 !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 6px !important;
      padding-left: 14px !important;
      padding-right: 14px !important;
    }
    #atelier-header button[data-open-booking] svg:not(:first-child),
    header button[data-open-booking] svg:not(:first-child),
    #atelier-header button[data-open-booking] .wynn-merged-phone-icon ~ svg,
    header button[data-open-booking] .wynn-merged-phone-icon ~ svg {
      display: none !important;
    }
    #atelier-header #btn-mobile-menu,
    header #btn-mobile-menu {
      flex-shrink: 0 !important;
    }
    .claim-claimed-btn {
      background: linear-gradient(135deg, #059669 0%, #047857 100%) !important;
      border-color: rgba(167, 243, 208, 0.55) !important;
      box-shadow: 0 10px 24px rgba(5, 150, 105, 0.45) !important;
      animation: none !important;
    }
    .claim-bar.deal-active {
      border: 1.5px solid rgba(232, 185, 72, 0.75);
      box-shadow: 0 24px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(232, 185, 72, 0.35);
      padding-top: 40px;
    }
    .claim-bar.deal-active .claim-collapse-btn {
      top: 15px;
      z-index: 30;
      opacity: 0.85;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 9999px;
      padding: 3px 14px;
    }
    .claim-bar.deal-active .claim-collapse-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.16);
    }
    .claim-deal-floating-seal {
      position: absolute;
      top: -15px;
      left: 50%;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: linear-gradient(135deg, #fff3d1 0%, #e8b948 35%, #c88a1b 70%, #995c07 100%);
      color: #1a1207;
      font-weight: 900;
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 5px 14px;
      border-radius: 9999px;
      border: 1.5px solid rgba(255, 255, 255, 0.85);
      box-shadow: 0 8px 24px rgba(200, 138, 27, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.8);
      z-index: 25;
      white-space: nowrap;
      animation: seal-float-pulse 3s ease-in-out infinite;
      text-shadow: 0 1px 1px rgba(255, 255, 255, 0.4);
    }
    .seal-pct {
      background: #1a1207;
      color: #fce08a;
      padding: 1.5px 7px;
      border-radius: 9999px;
      font-size: 10.5px;
      font-weight: 950;
      letter-spacing: 0.04em;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    .seal-divider {
      opacity: 0.35;
      font-weight: 400;
    }
    .seal-price {
      color: #3b2005;
      font-weight: 850;
      font-size: 10.5px;
    }
    @keyframes seal-float-pulse {
      0%, 100% {
        transform: translateX(-50%) translateY(0);
        box-shadow: 0 8px 22px rgba(200, 138, 27, 0.5), 0 2px 6px rgba(0,0,0,0.4);
      }
      50% {
        transform: translateX(-50%) translateY(-2.5px);
        box-shadow: 0 12px 30px rgba(200, 138, 27, 0.75), 0 3px 8px rgba(0,0,0,0.5), 0 0 16px rgba(255, 243, 209, 0.7);
      }
    }
    .claim-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .claim-badge {
      width: 44px; height: 44px; border-radius: 13px;
      background: #96432b;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      text-decoration: none;
      border: 1px solid rgba(232, 185, 72, 0.45);
      transition: all 0.2s ease;
      cursor: pointer;
      overflow: hidden;
      padding: 4px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
    .claim-badge:hover {
      transform: translateY(-1px) scale(1.05);
      border-color: rgba(232, 185, 72, 0.85);
      box-shadow: 0 6px 18px rgba(150, 67, 43, 0.5);
    }
    .claim-badge-img {
      width: 100%; height: 100%; object-fit: contain; display: block;
    }
    .claim-meta { min-width: 0; }
    .claim-tag {
      font-size: 10px; font-weight: 800; text-transform: uppercase;
      letter-spacing: 0.08em; color: #fbdeb9; display: flex; align-items: center; gap: 6px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;
    }
    .claim-studio-link {
      color: #e8b948;
      text-decoration: none;
      display: inline-flex; align-items: center; gap: 3px;
      background: rgba(232, 185, 72, 0.12);
      border: 1px solid rgba(232, 185, 72, 0.3);
      padding: 1px 7px;
      border-radius: 6px;
      transition: all 0.18s ease;
      flex-shrink: 0;
    }
    .claim-studio-link:hover {
      background: rgba(232, 185, 72, 0.22);
      border-color: rgba(232, 185, 72, 0.6);
      color: #ffffff;
      transform: translateY(-0.5px);
    }
    .claim-deal-badge {
      background: linear-gradient(135deg, #d49b28 0%, #b87b1c 100%);
      color: #1c1917;
      font-weight: 800;
      padding: 1px 7px;
      border-radius: 6px;
      font-size: 9.5px;
      letter-spacing: 0.04em;
    }
    .claim-ext-arrow { width: 10px; height: 10px; display: inline-block; flex-shrink: 0; }
    .claim-bullet { color: rgba(251, 222, 185, 0.4); font-size: 8px; flex-shrink: 0; }
    .claim-tag-text { color: rgba(251, 222, 185, 0.85); font-weight: 700; letter-spacing: 0.06em; white-space: nowrap; }
    .claim-title {
      display: flex; align-items: baseline; gap: 6px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .claim-for-text {
      font-size: 11.5px; font-weight: 600; color: #b8b0a5; letter-spacing: 0.03em; text-transform: uppercase; flex-shrink: 0;
    }
    .claim-biz-highlight {
      font-size: 16.5px; font-weight: 800; color: #ffffff;
      letter-spacing: -0.01em; text-shadow: 0 1px 4px rgba(0,0,0,0.6);
      overflow: hidden; text-overflow: ellipsis;
    }
    .claim-reassure {
      font-size: 10.5px;
      color: #e6dccb;
      font-weight: 500;
      margin-top: 3px;
      display: flex;
      align-items: center;
      gap: 5px;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .claim-reassure-check {
      color: #34d399;
      font-weight: 800;
      flex-shrink: 0;
    }
    .claim-countdown-wrap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(232, 185, 72, 0.12);
      border: 1px solid rgba(232, 185, 72, 0.35);
      padding: 3px 10px;
      border-radius: 10px;
      font-size: 11px;
      margin-top: 3px;
    }
    .cd-label {
      color: #fbdeb9;
      font-weight: 700;
      font-size: 9.5px;
      letter-spacing: 0.05em;
    }
    .cd-timer {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      color: #ffffff;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .claim-actions {
      display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    }
    .claim-studio-btn {
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(229, 222, 201, 0.22);
      color: #f6f1e8;
      text-decoration: none;
      font-size: 12px;
      font-weight: 600;
      padding: 11px 15px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.18s ease;
      white-space: nowrap;
    }
    .claim-studio-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(232, 185, 72, 0.5);
      color: #ffffff;
      transform: translateY(-1px);
    }
    .claim-btn {
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
      background: linear-gradient(135deg, #8B3A22 0%, #6E2C1A 100%) !important;
      opacity: 1 !important;
      color: #ffffff;
      text-decoration: none;
      font-size: 13px;
      font-weight: 800;
      padding: 12px 22px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(251, 222, 185, 0.36);
      box-shadow: 0 10px 26px rgba(110, 44, 26, 0.5), 0 4px 12px rgba(0, 0, 0, 0.28);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      white-space: nowrap;
      animation: claim-glow 3.8s ease-in-out infinite;
      box-sizing: border-box;
    }
    .claim-btn.claim-deal-btn {
      background: linear-gradient(135deg, #b83a24 0%, #d4452a 100%);
      border-color: rgba(232, 185, 72, 0.6);
      box-shadow: 0 10px 26px rgba(212, 69, 42, 0.6), 0 0 16px rgba(232, 185, 72, 0.4);
    }
    .claim-btn::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -130%;
      width: 70%;
      height: 200%;
      background: linear-gradient(110deg, transparent 20%, rgba(255, 255, 255, 0.22) 45%, rgba(255, 255, 255, 0.42) 50%, rgba(255, 255, 255, 0.22) 55%, transparent 80%);
      transform: skewX(-20deg);
      pointer-events: none;
      animation: claim-sheen 4.8s ease-in-out infinite;
    }
    .claim-btn:hover {
      background: linear-gradient(135deg, #a84b31 0%, #bd5538 100%);
      transform: translateY(-1.5px) scale(1.02);
      box-shadow: 0 14px 32px rgba(150, 67, 43, 0.6), 0 0 0 1px rgba(251, 222, 185, 0.45);
      color: #ffffff;
    }
    .claim-btn:hover .claim-arrow {
      transform: translateX(3px);
    }
    .claim-arrow {
      transition: transform 0.2s ease;
      display: inline-block;
    }
    @keyframes claim-sheen {
      0%, 65% { left: -130%; opacity: 0; }
      70% { opacity: 1; }
      85% { left: 160%; opacity: 0.9; }
      90%, 100% { left: 160%; opacity: 0; }
    }
    @keyframes claim-glow {
      0%, 100% {
        box-shadow: 0 10px 24px rgba(150, 67, 43, 0.45);
        border-color: rgba(251, 222, 185, 0.28);
      }
      50% {
        box-shadow: 0 12px 28px rgba(150, 67, 43, 0.65), 0 0 18px rgba(232, 185, 72, 0.35);
        border-color: rgba(232, 185, 72, 0.6);
      }
    }
    @media (max-width: 640px) {
      .claim-bar {
        flex-direction: column;
        align-items: stretch;
        padding: 22px 14px 12px 14px;
        bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        gap: 10px;
        border-radius: 20px;
        width: calc(100% - 20px);
        max-width: 100%;
        overflow: visible;
      }
      .claim-bar.deal-active {
        padding-top: 42px;
      }
      .claim-bar.deal-active .claim-collapse-btn {
        top: 15px;
      }
      .claim-deal-floating-seal {
        top: -15px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 10.5px;
        padding: 4.5px 12px;
        gap: 5px;
        max-width: calc(100% - 16px);
      }
      @keyframes seal-float-pulse {
        0%, 100% {
          transform: translateX(-50%) translateY(0);
          box-shadow: 0 8px 22px rgba(200, 138, 27, 0.5), 0 2px 6px rgba(0,0,0,0.4);
        }
        50% {
          transform: translateX(-50%) translateY(-2px);
          box-shadow: 0 12px 28px rgba(200, 138, 27, 0.75), 0 3px 8px rgba(0,0,0,0.5), 0 0 16px rgba(255, 243, 209, 0.7);
        }
      }
      .claim-actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        width: 100%;
      }
      .claim-btn {
        width: 100%;
        justify-content: center;
        padding: 13px 12px;
        font-size: 13.5px;
        font-weight: 850;
        white-space: normal;
        text-align: center;
        box-sizing: border-box;
        border-radius: 14px;
        letter-spacing: 0.01em;
      }
      .claim-btn span {
        white-space: normal;
        line-height: 1.25;
        word-break: keep-all;
      }
      .claim-studio-btn {
        justify-content: center;
        padding: 4px 10px;
        font-size: 11px;
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.68);
        text-decoration: underline;
        margin: 0 auto;
      }
      .claim-studio-btn:hover {
        background: transparent;
        color: #ffffff;
      }
      .claim-tag-text { display: none; }
      .claim-bullet { display: none; }
      .claim-for-text { font-size: 10px; }
      .claim-biz-highlight { font-size: 15px; }
      .claim-reassure {
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        align-items: flex-start;
        line-height: 1.35;
      }
    }
  </style>
  <div id="wynn-claim-bar" class="claim-bar ${isFlashDeal ? 'deal-active' : ''} ${isPaid ? 'claimed-active' : ''}">
    <button type="button" id="wynn-claim-collapse" class="claim-collapse-btn" title="Minimise bar" aria-label="Minimise bar">
      <svg width="15" height="8" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2L9 8L16 2"/></svg>
    </button>
    ${isFlashDeal ? `
      <div class="claim-deal-floating-seal">
        <span class="seal-icon">⚡</span>
        <span class="seal-pct">50% OFF</span>
        <span class="seal-divider">|</span>
        <span>ATELIER SPONSORSHIP</span>
        <span class="seal-price">&bull; SAVE $300 AUD</span>
      </div>
    ` : ''}
    <div class="claim-left">
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="claim-badge" title="Visit WynnPages Studio (wynnpages.com.au)">
        <img src="https://wynnpages.com.au/assets/favicon-light.png" alt="WynnPages Atelier" class="claim-badge-img">
      </a>
      <div class="claim-meta">
        ${isPaid ? `
          <div class="claim-tag" style="color:#6ee7b7;">
            <span class="claim-tag-text" style="color:#6ee7b7;font-weight:800;">🎉 OFFICIALLY CLAIMED</span>
            <span class="claim-bullet">•</span>
            <span class="claim-tag-text" style="color:#d1fae5;">100% Client Ownership</span>
          </div>
          <div class="claim-title">
            <strong class="claim-biz-highlight" style="font-size:14.5px;">🎉 This website has been officially claimed!</strong>
          </div>
        ` : `
          <div class="claim-tag">
            ${isFlashDeal ? `
              <span class="claim-tag-text" style="color:#f6ddb8;font-weight:800;">72-HOUR FLASH WINDOW</span>
              <span class="claim-bullet">•</span>
              <span class="claim-tag-text" style="color:#fbdeb9;">$299 AUD Flat Fee</span>
            ` : `
              <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="claim-studio-link" title="Visit WynnPages Studio (wynnpages.com.au)">
                <span>wynnpages.com.au</span>
                <svg class="claim-ext-arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"/>
                </svg>
              </a>
              <span class="claim-bullet">•</span>
              <span class="claim-tag-text">Bespoke Demo</span>
              <span class="claim-bullet">•</span>
              <span class="claim-tag-text">No Monthly Fees</span>
            `}
          </div>
          <div class="claim-title">
            <span class="claim-for-text">Exclusively for</span>
            <strong class="claim-biz-highlight">${bizName}</strong>
          </div>
          <div class="claim-reassure">
            <span class="claim-reassure-check">✓</span>
            <span>100% tailored with your real photos &amp; menu</span>
          </div>
          ${isFlashDeal ? `
            <div class="claim-countdown-wrap">
              <span class="cd-label">OFFER EXPIRES IN:</span>
              <span class="cd-timer" id="claim-cd-display">--h : --m : --s</span>
            </div>
          ` : ''}
        `}
      </div>
    </div>
    <div class="claim-actions">
      ${isPaid ? `
        <a href="${revisionHref}" class="claim-btn claim-claimed-btn">
          <span>👉 Next Step: Customise Content &amp; Connect Domain</span>
          <span class="claim-arrow">&rarr;</span>
        </a>
      ` : `
        <a href="${claimHref}" class="claim-btn ${isFlashDeal ? 'claim-deal-btn' : ''}">
          <span>${btnLabel}</span>
          <span class="claim-arrow">&rarr;</span>
        </a>
      `}
    </div>
  </div>
  <button type="button" id="wynn-claim-restore" class="claim-restore-tab" aria-label="Expand website banner">
    <span class="claim-restore-dot"></span>
    <svg width="12" height="7" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8L9 2L16 8"/></svg>
    <span>${isPaid ? 'Next Step &bull; Setup Content' : (isFlashDeal ? 'Claim This Website <span class="claim-restore-price">&mdash; $299</span>' : 'Claim This Website <span class="claim-restore-price">&mdash; $599</span>')}</span>
  </button>
  <script>
    (function(){
      var bar = document.getElementById('wynn-claim-bar');
      var collapseBtn = document.getElementById('wynn-claim-collapse');
      var restoreBtn = document.getElementById('wynn-claim-restore');
      if (!bar || !collapseBtn || !restoreBtn) return;
      document.body.classList.add('wynn-claim-expanded');
      document.body.classList.remove('wynn-claim-collapsed');
      var manualCollapsedAt = 0;
      function setCollapsed(collapsed) {
        if (collapsed) {
          bar.classList.add('is-collapsed');
          restoreBtn.classList.add('visible');
          document.body.classList.remove('wynn-claim-expanded');
          document.body.classList.add('wynn-claim-collapsed');
          manualCollapsedAt = Date.now();
        } else {
          bar.classList.remove('is-collapsed');
          restoreBtn.classList.remove('visible');
          document.body.classList.add('wynn-claim-expanded');
          document.body.classList.remove('wynn-claim-collapsed');
        }
      }
      collapseBtn.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setCollapsed(true);
      });
      restoreBtn.addEventListener('click', function() {
        setCollapsed(false);
      });
      // Merge phone icon into sticky header "Book Visit" button & remove trailing arrow
      try {
        var hdrBookBtn = document.querySelector('#atelier-header button[data-open-booking], header button[data-open-booking]');
        if (hdrBookBtn) {
          var svgs = hdrBookBtn.querySelectorAll('svg');
          svgs.forEach(function(s, idx) {
            if (s.closest('.wynn-merged-phone-icon')) return;
            if (s.getAttribute('viewBox') === '0 0 16 16' || s.innerHTML.indexOf('M3.5 8h9') !== -1 || idx > 0) {
              s.remove();
            }
          });
          if (!hdrBookBtn.querySelector('.wynn-merged-phone-icon') && !hdrBookBtn.querySelector('path[d*="22 16.92"]')) {
            var phoneSpan = document.createElement('span');
            phoneSpan.className = 'wynn-merged-phone-icon';
            phoneSpan.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;';
            phoneSpan.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
            hdrBookBtn.insertBefore(phoneSpan, hdrBookBtn.firstChild);
          }
        }
      } catch (_) {}
      window.addEventListener('scroll', function() {
        if (!bar.classList.contains('is-collapsed')) return;
        if (Date.now() - manualCollapsedAt < 1200) return;
        var docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        if (window.scrollY + window.innerHeight >= docH - 150) {
          setCollapsed(false);
        }
      }, { passive: true });
    })();
  </script>
  ${isFlashDeal ? `
  <script>
    (function(){
      var exp = ${expiresTimestamp};
      if (!exp) return;
      function updateCd() {
        var diff = exp - Date.now();
        var el = document.getElementById('claim-cd-display');
        var elTop = document.getElementById('top-bar-cd-display');
        if (diff <= 0) {
          if (el) el.textContent = '00:00:00 (Expired)';
          if (elTop) elTop.textContent = 'Expired';
          setTimeout(function(){ window.location.reload(); }, 2500);
          return;
        }
        var days = Math.floor(diff / (1000 * 60 * 60 * 24));
        var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        var mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        var secs = Math.floor((diff % (1000 * 60)) / 1000);
        var str = (days > 0 ? (days + 'd : ') : '') +
                  (hours < 10 ? '0' : '') + hours + 'h : ' +
                  (mins < 10 ? '0' : '') + mins + 'm : ' +
                  (secs < 10 ? '0' : '') + secs + 's';
        if (el) el.textContent = str;
        if (elTop) elTop.textContent = str;
      }
      updateCd();
      setInterval(updateCd, 1000);
    })();
  </script>
  ` : ''}`;
}

function injectClaimBarIntoHtml(rawHtml, client) {
  let isFlashDeal = false;
  if (client && client.dealStatus === 'flash_deal' && client.dealExpiresAt) {
    if (new Date(client.dealExpiresAt).getTime() > Date.now()) {
      isFlashDeal = true;
    }
  }

  const cleanSlug = slugifyName((client && (client.demoSlug || client.id || client.businessName)) || '');
  const cidVal = (client && client.id && !String(client.id).startsWith('local_') ? client.id : '').replace(/'/g, '');
  const beaconScript = cleanSlug ? `
  <script>
    (function(){
      try {
        var s = '${cleanSlug}';
        var cid = '${cidVal}';
        if (!s) return;
        var q = window.location.search || '';
        if (q.indexOf('admin=') !== -1 || q.indexOf('preview=') !== -1 || q.indexOf('bar=1') !== -1) return;
        if (document.cookie && /(?:^|;\\s*)wynn_admin=1(?:;|$)/.test(document.cookie)) return;
        if (window.localStorage && window.localStorage.getItem('wynn_admin_key')) return;
        function sendTrack(evType) {
          try {
            var payload = JSON.stringify({
              slug: s,
              clientId: cid,
              eventType: evType || 'demo_view'
            });
            var endpoint = '/api/track?slug=' + encodeURIComponent(s) + '&type=' + encodeURIComponent(evType || 'demo_view');
            if (navigator.sendBeacon) {
              var blob = new Blob([payload], { type: 'application/json' });
              if (navigator.sendBeacon(endpoint, blob)) return;
            }
            fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: payload,
              keepalive: true
            }).catch(function(){});
          } catch(e){}
        }
        var ssKey = 'wynn_dv_ss_' + s;
        var viewTracked = Boolean(window.sessionStorage && window.sessionStorage.getItem(ssKey));
        var delayReady = false;
        var humanInteracted = false;
        function tryFireHumanView() {
          if (viewTracked || !delayReady || !humanInteracted) return;
          viewTracked = true;
          try { if (window.sessionStorage) window.sessionStorage.setItem(ssKey, String(Date.now())); } catch(_) {}
          sendTrack('demo_view');
        }
        if (!viewTracked) {
          setTimeout(function() {
            delayReady = true;
            tryFireHumanView();
          }, 3000);
          var markHuman = function() {
            humanInteracted = true;
            tryFireHumanView();
          };
          ['scroll', 'touchstart', 'mousemove', 'keydown'].forEach(function(evtName) {
            window.addEventListener(evtName, markHuman, { once: true, passive: true });
          });
        }
        document.addEventListener('click', function(ev) {
          var el = ev.target && ev.target.closest ? ev.target.closest('.claim-btn') : null;
          if (el) sendTrack('claim_click');
        }, true);
      } catch(e){}
    })();
  </script>` : '';

  const spacer = `<style>.wynn-claim-clearance{height:108px;width:100%;pointer-events:none;}@media(max-width:640px){.wynn-claim-clearance{height:180px;}}</style><div class="wynn-claim-clearance" aria-hidden="true"></div>`;
  const snippet = spacer + buildClaimBarSnippet(client) + beaconScript;
  let html = rawHtml;

  // On desktop screens only (>= 768px), keep top ribbon as a secondary subtle luxury header bar; on mobile, completely remove top bar to eliminate duplicate clutter
  if (isFlashDeal) {
    const topBarHtml = buildDealTopRibbonHtml(client);
    if (html.includes('<body')) {
      html = html.replace(/(<body[^>]*>)/i, `$1${topBarHtml}`);
    } else {
      html = topBarHtml + html;
    }
  }

  if (html.includes('</body>')) {
    return html.replace('</body>', `${snippet}</body>`);
  }
  return html + snippet;
}

function buildBrandedPreviewHtml(client, options = {}) {
  const isPaid = client && (client.paymentStatus === 'paid' || client.stage === 'launched');
  const isDealExpired = client && (client.dealStatus === 'expired' || client.dealStatus === 'purged');
  if (!isPaid && isDealExpired && !options.bypass) {
    return buildExpiredDemoHtml(client);
  }

  const rawBiz = String((client && (client.businessName || client.name)) || 'Your Business').trim();
  const bizName = (rawBiz === rawBiz.toLowerCase()) ? rawBiz.replace(/\b\w/g, (c) => c.toUpperCase()) : rawBiz;
  let rawDemo = (client && client.demoUrl) || 'https://wynnpages.com.au';
  if (rawDemo && !rawDemo.startsWith('http')) rawDemo = 'https://' + rawDemo;
  const slug = (client && client.demoSlug) || '';
  const isSelfLoop = slug && rawDemo.toLowerCase().includes(`${slug}.wynnpages.com.au`);
  const bodyContent = isSelfLoop
    ? `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f1e8;color:#2b251e;font-family:'Plus Jakarta Sans',sans-serif;padding:24px 24px 130px;text-align:center;">
        <div style="max-width:500px;background:#fcf9f3;padding:40px 36px;border-radius:28px;border:1px solid rgba(197,160,89,0.42);box-shadow:0 20px 44px -16px rgba(43,37,30,0.12);">
          <div style="width:56px;height:56px;border-radius:999px;background:radial-gradient(circle at 32% 28%,#fffdf9 0%,#f5e5c0 62%,#dfc082 100%);border:1px solid rgba(212,155,40,0.45);box-shadow:inset 0 2px 4px rgba(255,255,255,0.85),0 8px 20px rgba(150,67,43,0.16);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;"><img src="https://wynnpages.com.au/assets/favicon.png" alt="WynnPages Studio" style="width:32px;height:32px;object-fit:contain;display:block;"></div>
          <p style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#96432b;margin-bottom:8px;">WynnPages Australian Web Atelier</p>
          <h2 style="font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:600;color:#2b251e;line-height:1.15;margin-bottom:10px;">Bespoke Concept in <em style="color:#96432b;">Final Preparation.</em></h2>
          <p style="font-size:13px;color:#6b5e51;line-height:1.65;margin-bottom:22px;">
            Our Australian design engineers are putting the finishing touches on the custom website preview crafted exclusively for <strong>${bizName}</strong>.
          </p>
          <a href="https://wynnpages.com.au" style="display:inline-block;padding:11px 22px;border-radius:999px;background:#2b251e;color:#faf6f0;font-size:12px;font-weight:600;text-decoration:none;">Explore WynnPages Studio &rarr;</a>
        </div>
      </div>`
    : `<iframe src="${rawDemo.replace(/"/g, '&quot;')}" title="${bizName.replace(/"/g, '&quot;')} Demo Preview" allow="fullscreen"></iframe>`;

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${bizName} — Bespoke Website Preview</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${bizName.replace(/"/g, '&quot;')} — Bespoke Website Preview">
  <meta property="og:image" content="/og-share.jpg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="/og-share.jpg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,600&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #1c1917; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
    iframe { width: 100%; height: 100%; border: 0; display: block; background: #f6f1e8; }
  </style>
</head>
<body>
  ${bodyContent}
  ${buildClaimBarSnippet(client)}
</body>
</html>`;
}

function buildClientMonogramFaviconSvg(bizName, palette = '01') {
  const cleanAlpha = String(bizName || '').replace(/[^A-Za-z]/g, '');
  const initial = (cleanAlpha.charAt(0) || 'A').toUpperCase();
  const themes = {
    '01': { bg1: '#FCF9F3', bg2: '#F3DFB2', ring: '#D49B28', accent: '#96432B' },
    '02': { bg1: '#FFFDFB', bg2: '#F5DFD4', ring: '#C89378', accent: '#9E5850' },
    '03': { bg1: '#FAFCF8', bg2: '#DCE6DF', ring: '#B59461', accent: '#466052' },
    '04': { bg1: '#FCF9F4', bg2: '#EFE0BE', ring: '#C69C47', accent: '#5C4033' },
    '05': { bg1: '#FAFCFD', bg2: '#DDE6EC', ring: '#C4A267', accent: '#3D5A6C' }
  };
  const t = themes[palette] || themes['01'];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="wax" cx="32%" cy="28%" r="72%">
      <stop offset="0%" stop-color="${t.bg1}"/>
      <stop offset="72%" stop-color="${t.bg2}"/>
      <stop offset="100%" stop-color="${t.bg2}"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#wax)" stroke="${t.ring}" stroke-width="2.2"/>
  <circle cx="32" cy="32" r="25.5" fill="none" stroke="${t.ring}" stroke-width="0.9" stroke-opacity="0.55"/>
  <text x="32" y="42.5" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="700" font-size="31" fill="${t.accent}">${initial}</text>
</svg>`;
}

function buildClientRobotsTxt(origin) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function buildClientSitemapXml(origin, meta) {
  const lastmod = (meta && meta.uploadedAt ? String(meta.uploadedAt).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const pages = new Set(['/']);
  if (meta && Array.isArray(meta.filesList)) {
    for (const f of meta.filesList) {
      if (typeof f === 'string' && /\.html$/i.test(f)) {
        const clean = f === '/index.html' ? '/' : f.replace(/\/index\.html$/i, '/');
        pages.add(clean.startsWith('/') ? clean : '/' + clean);
      }
    }
  }
  const urlNodes = Array.from(pages).map((p) => {
    const loc = `${origin}${p}`.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const prio = p === '/' ? '1.0' : '0.8';
    return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${prio}</priority>\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlNodes}\n</urlset>\n`;
}

function ensureClientHtmlSeoTags(rawHtml, client, reqUrl, isPathDemo = false, slug = '') {
  if (!rawHtml || typeof rawHtml !== 'string') return rawHtml;
  const assetOrigin = isPathDemo && slug ? `https://${slug}.wynnpages.com.au` : reqUrl.origin;
  const cleanPath = (isPathDemo || reqUrl.pathname === '/index.html' || reqUrl.pathname === '') ? '/' : reqUrl.pathname;
  const canonicalUrl = `${assetOrigin}${cleanPath}`;
  const ogShareUrl = `${assetOrigin}/og-share.jpg`;
  const bizName = ((client && (client.businessName || client.name)) || slug || 'Boutique Sanctuary').replace(/"/g, '&quot;');

  let html = rawHtml;

  // 1. Replace any accidental WynnPages studio favicon in <head> with client's bespoke favicon
  html = html.replace(
    /<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]+wynnpages\.com\.au\/assets\/favicon[^>]*>/gi,
    `<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n  <link rel="icon" type="image/png" sizes="192x192" href="/favicon.png">\n  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`
  );

  // 2. Canonical URL
  if (/<link[^>]+rel=["']canonical["'][^>]*>/i.test(html)) {
    html = html.replace(/<link([^>]+)rel=["']canonical["']([^>]*)>/i, `<link rel="canonical" id="page-canonical" href="${canonicalUrl}">`);
  } else if (html.includes('</head>')) {
    html = html.replace('</head>', `  <link rel="canonical" href="${canonicalUrl}">\n</head>`);
  }

  // 3. Meta Robots (ready for Google Search Console indexing)
  if (!/<meta[^>]+name=["']robots["'][^>]*>/i.test(html) && html.includes('</head>')) {
    html = html.replace('</head>', `  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">\n</head>`);
  }

  // 4. Absolute og:url, og:image, twitter:image for Facebook / iMessage / WhatsApp / Zalo
  if (/<meta[^>]+property=["']og:url["'][^>]*>/i.test(html)) {
    html = html.replace(/<meta[^>]+property=["']og:url["'][^>]*>/i, `<meta property="og:url" id="og-url" content="${canonicalUrl}">`);
  } else if (html.includes('</head>')) {
    html = html.replace('</head>', `  <meta property="og:url" content="${canonicalUrl}">\n</head>`);
  }

  if (/<meta[^>]+property=["']og:image["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta([^>]+)property=["']og:image["']([^>]*)content=["'](?:\.\/|\/og-share\.jpg|https:\/\/wynnpages\.com\.au\/assets\/atelier\/nails\/(?:hero-sanctuary|p0[2-5]\/hero)\.jpg)["']([^>]*)>/i,
      `<meta property="og:image" id="og-image" content="${ogShareUrl}">`
    );
  } else if (html.includes('</head>')) {
    html = html.replace(
      '</head>',
      `  <meta property="og:image" content="${ogShareUrl}">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n</head>`
    );
  }

  if (/<meta[^>]+name=["']twitter:image["'][^>]*>/i.test(html)) {
    html = html.replace(
      /<meta([^>]+)name=["']twitter:image["']([^>]*)content=["'](?:\.\/|\/og-share\.jpg|https:\/\/wynnpages\.com\.au\/assets\/atelier\/nails\/(?:hero-sanctuary|p0[2-5]\/hero)\.jpg)["']([^>]*)>/i,
      `<meta name="twitter:image" id="tw-image" content="${ogShareUrl}">`
    );
  } else if (html.includes('</head>')) {
    html = html.replace(
      '</head>',
      `  <meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:title" content="${bizName}">\n  <meta name="twitter:image" content="${ogShareUrl}">\n</head>`
    );
  }

  // 5. Upgrade relative /og-share.jpg inside JSON-LD to absolute URL and replace any template placeholder "Maison Élan" in SEO/OG/JSON-LD tags
  html = html.replace(/"image":\s*"\/og-share\.jpg"/g, `"url": "${canonicalUrl}",\n      "image": "${ogShareUrl}"`);
  if (bizName && bizName !== 'Maison Élan') {
    html = html
      .replace(/(<meta[^>]+property=["']og:(?:site_name|title|image:alt)["'][^>]*content=["'][^"']*?)Maison Élan/gi, `$1${bizName}`)
      .replace(/(<meta[^>]+name=["']twitter:title["'][^>]*content=["'][^"']*?)Maison Élan/gi, `$1${bizName}`)
      .replace(/"name":\s*"Maison Élan"/g, `"name": "${bizName.replace(/"/g, '\\"')}"`);
  }

  return html;
}

function escapeTelegramHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function recordStudioActivity(env, payload = {}, ctx = null) {
  if (!env || !payload) return null;
  return recordActivityAndNotify({
    type: payload.type || 'system',
    icon: payload.icon || '',
    title: payload.title || 'WynnPages Studio Activity',
    message: payload.message || '',
    clientName: payload.clientName || '',
    slug: payload.slug || '',
    dedupeKey: payload.dedupeKey || '',
    dedupeTtl: payload.dedupeTtl || 3600,
    waitForTelegram: Boolean(payload.waitForTelegram),
    env,
    ctx
  });
}

async function notifyTelegramAutomatedComms({
  env,
  ctx = null,
  client = {},
  triggerType = 'automated_comms',
  icon = '📲',
  title,
  views = null,
  smsSent = false,
  smsSkippedReason = '',
  smsTo = '',
  smsText = '',
  emailSent = false,
  emailSkippedReason = '',
  emailTo = '',
  emailSubject = '',
  extraNote = '',
  waitForTelegram = false
}) {
  if (!env) return null;
  const biz = (client && (client.businessName || client.name)) || 'Khách hàng';
  const slug = (client && (client.demoSlug || slugifyName(biz))) || '';
  const demoUrl = (client && (client.demoUrl || client.brandedDemoUrl)) || (slug ? `https://${slug}.wynnpages.com.au` : '');
  const lines = [];
  lines.push(`🏢 Khách: ${biz}`);
  if (demoUrl) lines.push(`🌐 Web Demo: ${demoUrl}`);
  if (views !== null && views !== undefined) lines.push(`👀 Lượt xem Demo: ${Number(views || 0)}`);
  if (extraNote) lines.push(`ℹ️ Ghi chú: ${extraNote}`);

  if (smsText || smsTo || smsSent || smsSkippedReason) {
    lines.push(
      smsSent
        ? `📱 SMS: ✅ Đã gửi tới ${smsTo || (client && client.phone) || 'N/A'}`
        : `📱 SMS: ⚠️ Chưa gửi (${smsSkippedReason || 'Chưa có SĐT / Bỏ qua'})`
    );
    if (smsText) {
      const trimmedSms = String(smsText).trim();
      lines.push(`💬 Nội dung SMS:\n"${trimmedSms.length > 440 ? trimmedSms.slice(0, 437) + '...' : trimmedSms}"`);
    }
  }

  if (emailSubject || emailTo || emailSent || emailSkippedReason) {
    lines.push(
      emailSent
        ? `📧 Email: ✅ Đã gửi tới ${emailTo || (client && client.email) || 'N/A'}${emailSubject ? `\n📝 Tiêu đề Email: ${emailSubject}` : ''}`
        : `📧 Email: ⚠️ Chưa gửi (${emailSkippedReason || 'Chưa có Email / Chưa cấu hình'})`
    );
  }

  return recordActivityAndNotify({
    type: triggerType,
    icon,
    title: title || `Thông báo gửi SMS/Email: ${biz}`,
    message: lines.join('\n'),
    clientName: biz,
    slug,
    dedupeKey: '',
    waitForTelegram,
    env,
    ctx
  }).catch(() => null);
}

// Record in-app activity feed event in D1/KV and broadcast instant push (Telegram Bot)
async function recordActivityAndNotify({ type, icon: customIcon = '', title, message, clientName, slug, dedupeKey = '', dedupeTtl = 86400, waitForTelegram = false, env, ctx }) {
  if (!env) return null;
  if (dedupeKey) {
    const acquired = await acquireD1RateLock(env, dedupeKey, dedupeTtl);
    if (!acquired) return { ok: true, deduped: true };
  }
  const nowIso = new Date().toISOString();
  const eventId = 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  let icon = customIcon || '🔔';
  if (!customIcon) {
    if (type === 'demo_viewed') icon = '👀';
    else if (type === 'claim_clicked') icon = '💳';
    else if (type === 'payment_received') icon = '💰';
    else if (type === 'revision_submitted' || type === 'brief_completed') icon = '📝';
    else if (type === 'domain_updated') icon = '🌐';
    else if (type === 'demo_self_unlocked') icon = '🔓';
    else if (type === 'ai_revision_applied') icon = '🤖';
  }

  const newEvent = {
    id: eventId,
    type: type || 'system',
    icon,
    title: title || 'WynnPages Activity',
    message: message || '',
    clientName: clientName || '',
    slug: slug || '',
    timestamp: nowIso
  };

  // 1. Store activity in D1 activity_events table (zero KV writes when D1 is available)
  const db = getD1(env);
  if (db) {
    await ensureD1Schema(env);
    await db.prepare(
      `INSERT INTO activity_events (id, type, icon, title, message, client_name, slug, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newEvent.id, newEvent.type, newEvent.icon, newEvent.title, newEvent.message, newEvent.clientName, newEvent.slug, newEvent.timestamp).run().catch(() => {});
  } else if (env.WYNN_KV) {
    try {
      const existingEvents = (await env.WYNN_KV.get('activity_events', 'json').catch(() => null)) || [];
      const updatedEvents = [newEvent, ...existingEvents.filter(e => e.id !== eventId)].slice(0, 30);
      await env.WYNN_KV.put('activity_events', JSON.stringify(updatedEvents)).catch(() => {});
    } catch (_) {}
  }

  // 2. Dispatch Telegram Bot Alert (HTML parse_mode + automatic plain-text fallback so underscores/filenames never fail)
  const sendTelegram = async () => {
    try {
      const rt = await loadSyncedRuntime(env);
      const botToken = rt.cfg.telegramBotToken || '';
      const chatId = rt.cfg.telegramChatId || '';
      if (botToken && chatId) {
        const cleanSlugLink = slug && slug !== 'test' ? `https://${slugifyName(slug)}.wynnpages.com.au` : '';
        const timeStr = formatAuDateTime(new Date(), AU_TIMEZONE);
        const htmlLinks = [
          cleanSlugLink ? `<a href="${cleanSlugLink}">🌐 Xem Web Demo</a>` : '',
          `<a href="https://wynnpages.com.au/admin">🛠 Mở Studio Admin</a>`
        ].filter(Boolean).join('  •  ');
        const htmlText = `${icon} <b>${escapeTelegramHtml(title || 'WynnPages Activity')}</b>\n\n${escapeTelegramHtml(message || '')}\n\n🕒 <i>${escapeTelegramHtml(timeStr)}</i>\n👉 ${htmlLinks}`;

        const tgUrl = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
        const res = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: htmlText,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          })
        });
        if (res.ok) return true;
        // Plain-text fallback guarantee
        const plainText = `${icon} ${title || 'WynnPages Activity'}\n\n${message || ''}\n\n🕒 ${timeStr}\n👉 https://wynnpages.com.au/admin${cleanSlugLink ? `\n🌐 ${cleanSlugLink}` : ''}`;
        const fbRes = await fetch(tgUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: plainText,
            disable_web_page_preview: true
          })
        }).catch(() => null);
        return Boolean(fbRes && fbRes.ok);
      }
    } catch (tgErr) {
      console.error('[Telegram notify error]', tgErr);
    }
    return false;
  };

  if (waitForTelegram || !ctx || typeof ctx.waitUntil !== 'function') {
    newEvent.telegramSent = await sendTelegram();
  } else {
    runInBg(ctx, sendTelegram());
    newEvent.telegramSent = true;
  }
  return newEvent;
}

// Track client viewing their bespoke demo website (atomic D1 + KV mirror + async Stripe sync)
async function trackDemoView({ slug, request, env, client, stripeSecretKey, ctx }) {
  if (!slug || !env) return null;
  try {
    const url = request ? new URL(request.url) : null;
    const cookieHeader = (request && request.headers.get('cookie')) || '';
    if (url && (url.searchParams.get('admin') || url.searchParams.get('preview') || url.searchParams.get('bar') === '1')) {
      return null;
    }
    if (cookieHeader.includes('wynn_admin_key') || cookieHeader.includes('wynn_admin_session')) {
      return null;
    }
    const cleanSlug = slugifyName(slug);
    const userAgent = (request && request.headers.get('user-agent')) || '';
    const isMobile = /mobile|iphone|android|ipad/i.test(userAgent);
    const device = isMobile ? 'Mobile' : 'Desktop';
    const now = new Date().toISOString();
    const targetId = (client && client.id) || '';
    const bizName = (client && (client.businessName || client.name)) || cleanSlug;

    const d1Track = await recordD1TrackingEvent(env, {
      slug: cleanSlug,
      clientId: targetId,
      eventType: 'demo_view',
      device,
      userAgent,
      businessName: bizName
    });

    let viewCount = Number(d1Track.viewCount || 0);
    let firstViewedAt = now;
    if (!getD1(env) && env.WYNN_KV) {
      const kvKey = `demo_views:${cleanSlug}`;
      const existing = await env.WYNN_KV.get(kvKey, 'json').catch(() => null);
      viewCount = Math.max(viewCount, Number(existing?.viewCount || 0) + 1, 1);
      firstViewedAt = existing?.firstViewedAt || now;
      await env.WYNN_KV.put(kvKey, JSON.stringify({
        slug: cleanSlug,
        viewCount,
        firstViewedAt,
        lastViewedAt: now,
        lastDevice: device
      })).catch(() => {});
    }

    const updateObj = {
      slug: cleanSlug,
      viewCount,
      firstViewedAt,
      lastViewedAt: now,
      lastDevice: device
    };

    // Real-Time Event & Telegram Alert (Rate-limited to 1 alert per 30 minutes via D1 rate_locks)
    const lockKey = `demo_notify_lock:${cleanSlug}`;
    const lockAcquired = await acquireD1RateLock(env, lockKey, 1800);
    if (lockAcquired) {
      await recordActivityAndNotify({
        type: 'demo_viewed',
        title: '👀 Khách Đang Xem Demo!',
        message: `"${bizName}" vừa mở xem bản Demo của bạn! (${device})`,
        clientName: bizName,
        slug: cleanSlug,
        env,
        ctx
      });
    }

    // Asynchronously update Stripe customer metadata inside ctx.waitUntil
    if (stripeSecretKey && (targetId || cleanSlug)) {
      const bgStripe = async () => {
        try {
          let cid = targetId;
          if (!cid) {
            const found = await findCustomerBySlugOrId(cleanSlug, stripeSecretKey);
            if (found && found.id) cid = found.id;
          }
          if (!cid) return;
          const body = new URLSearchParams();
          body.append('metadata[demo_view_count]', String(viewCount));
          body.append('metadata[demo_first_viewed_at]', firstViewedAt);
          body.append('metadata[demo_last_viewed_at]', now);
          body.append('metadata[demo_viewer_device]', device);
          await fetch(`https://api.stripe.com/v1/customers/${cid}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: body.toString()
          });
        } catch (_) {}
      };
      runInBg(ctx, bgStripe());
    }
    return updateObj;
  } catch (_) {
    return null;
  }
}

async function hydrateAndStoreTemplateOnServer({ env, requestUrl, client, templateKey }) {
  if (!env || !env.ASSETS || !env.WYNN_KV || !client) return null;
  const slug = slugifyName(client.demoSlug || client.businessName || client.name || '');
  if (!slug) return null;

  const tplKey = String(templateKey || client.demoPalette || '').trim();
  const searchCtx = `${slug} ${client.businessName || ''} ${client.name || ''} ${client.industry || ''}`;
  const isTradie = tplKey.startsWith('tradie-') || /(water|plumb|drain|gas|elec|build|construct|tile|tiling|roof|carpenter|concret|tradie|hvac|paint|solar|fenc|landscap|tool|hardware|civil|commercial)/i.test(searchCtx);

  let assetPath = '/templates/nails-atelier.html';
  if (tplKey === 'tradie-luxury' || (!tplKey.startsWith('tradie-') && isTradie && /(build|architect|renov|luxury|home|interior|landscap|carpenter)/i.test(searchCtx))) {
    assetPath = '/templates/tradie-master/2-luxury-builder.html';
  } else if (tplKey === 'tradie-b2b' || (!tplKey.startsWith('tradie-') && isTradie && /(tile|tiling|commercial|civil|concret|steel|screed|waterproof|b2b|tool|hardware)/i.test(searchCtx))) {
    assetPath = '/templates/tradie-master/3-b2b-contractor.html';
  } else if (tplKey === 'tradie-emergency' || isTradie) {
    assetPath = '/templates/tradie-master/1-emergency-plumber.html';
  }

  try {
    const assetOrigin = 'https://wynnpages.com.au';
    let res = await env.ASSETS.fetch(new Request(`${assetOrigin}${assetPath}`));
    if (res && res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (loc) res = await env.ASSETS.fetch(new Request(new URL(loc, assetOrigin).toString()));
    }
    if (!res || !res.ok) {
      const cleanPath = assetPath.replace(/\.html$/i, '');
      res = await env.ASSETS.fetch(new Request(`${assetOrigin}${cleanPath}`));
      if (res && res.status >= 300 && res.status < 400) {
        const loc2 = res.headers.get('location');
        if (loc2) res = await env.ASSETS.fetch(new Request(new URL(loc2, assetOrigin).toString()));
      }
    }
    if (!res || !res.ok) return null;

    let html = await res.text();
    const bizName = client.businessName || client.name || slug || 'Your Business';
    const safeBiz = bizName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const initial = (bizName.replace(/[^A-Za-z]/g, '').charAt(0) || 'A').toUpperCase();
    const dPhone = client.displayPhone || client.phone || '1300 999 999';
    const sPhone = (client.phone || client.displayPhone || '1300999999').replace(/[^0-9+]/g, '');

    if (assetPath.includes('tradie-master')) {
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeBiz} | Official Website</title>`);
      html = html.replace(/<span class="brand-monogram">A<\/span>/g, `<span class="brand-monogram">${initial}</span>`);
      html = html.replace(/RAPID PLUMBING|AURA ARCHITECTURE|APEX COMM-TILING|ELITE BUILDERS/g, safeBiz);
      html = html.replace(/1300 999 999|1800 123 456/g, dPhone);
      html = html.replace(/tel:1300999999|tel:1800123456/g, `tel:${sPhone}`);
    } else {
      const pal = ['01', '02', '03', '04', '05'].includes(tplKey.replace('nails-', '')) ? tplKey.replace('nails-', '') : '01';
      html = html.replace(/data-palette="0[1-5]"/, `data-palette="${pal}"`);
      html = html.replace(/(salonName:\s*)"[^"]*"/, `$1${JSON.stringify(bizName)}`);
      html = html.replace(/(monogram:\s*)"[^"]*"/, `$1${JSON.stringify(initial)}`);
      if (dPhone) html = html.replace(/(displayPhone:\s*)"[^"]*"/, `$1${JSON.stringify(dPhone)}`);
      if (sPhone) html = html.replace(/(smsPhone:\s*)"[^"]*"/, `$1${JSON.stringify(sPhone)}`);
    }

    const nowIso = new Date().toISOString();
    await env.WYNN_KV.put(`site_asset:${slug}:/index.html`, html, {
      metadata: { mimeType: 'text/html; charset=utf-8', size: html.length, updatedAt: nowIso }
    });
    await env.WYNN_KV.put(`site_meta:${slug}`, JSON.stringify({
      slug,
      customerId: client.id || '',
      businessName: bizName,
      palette: tplKey || (isTradie ? 'tradie-emergency' : '01'),
      uploadedAt: nowIso,
      filesCount: 1,
      filesList: ['/index.html']
    }));
    return html;
  } catch (_) {
    return null;
  }
}

async function serveClientSpecialSeoOrAsset({ slug, client, reqPath, url, request, env, ctx, stripeSecretKey, isLiveDomain, isPathDemo, forceBar }) {
  const cleanSlug = slugifyName(slug);
  const baseOrigin = isPathDemo && cleanSlug ? `https://${cleanSlug}.wynnpages.com.au` : url.origin;

  // 1. HTML pages from KV
  if (env && env.WYNN_KV && cleanSlug && (reqPath === '/index.html' || reqPath.endsWith('.html'))) {
    let rawHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:${reqPath}`, 'text');
    let resolvedClient = client || null;
    if (!resolvedClient) {
      const dbCheck = getD1(env);
      if (dbCheck) {
        await ensureD1Schema(env);
        const d1Row = await dbCheck.prepare('SELECT * FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(cleanSlug).first().catch(() => null);
        if (d1Row) {
          let parsedMeta = {};
          if (d1Row.metadata_json) {
            try { parsedMeta = JSON.parse(d1Row.metadata_json) || {}; } catch (_) {}
          }
          resolvedClient = {
            ...parsedMeta,
            id: d1Row.id || parsedMeta.id,
            businessName: parsedMeta.businessName || d1Row.business_name || d1Row.name || cleanSlug,
            name: parsedMeta.name || d1Row.name || d1Row.business_name || cleanSlug,
            phone: parsedMeta.phone || d1Row.phone || '',
            displayPhone: parsedMeta.displayPhone || d1Row.phone || '',
            demoSlug: d1Row.demo_slug || parsedMeta.demoSlug || cleanSlug,
            paymentStatus: d1Row.payment_status || parsedMeta.paymentStatus,
            stage: d1Row.stage || parsedMeta.stage,
            liveUrl: d1Row.live_url || parsedMeta.liveUrl
          };
        }
      }
    }
    if (!resolvedClient && stripeSecretKey) {
      resolvedClient = await findCustomerBySlugOrId(slug, stripeSecretKey);
    }
    if (!rawHtml && reqPath === '/index.html' && resolvedClient && !isLiveDomain) {
      rawHtml = await hydrateAndStoreTemplateOnServer({
        env,
        requestUrl: url.toString(),
        client: resolvedClient,
        templateKey: resolvedClient.demoPalette
      });
    }
    if (rawHtml) {

      // CRITICAL PROTECTION: Never serve orphaned demo HTML if the client was deleted from CRM & Stripe
      if (!isLiveDomain && !resolvedClient) {
        runInBg(ctx, purgeDemoSiteAssetsFromKv(env, cleanSlug));
        return null;
      }

      const isPaid = resolvedClient && (resolvedClient.paymentStatus === 'paid' || resolvedClient.stage === 'launched');
      const bypass = url.searchParams.get('preview') || url.searchParams.get('admin') || url.searchParams.get('unlocked');
      const isDealExpired = resolvedClient && (resolvedClient.dealStatus === 'expired' || resolvedClient.dealStatus === 'purged');
      if (!isLiveDomain && !isPaid && isDealExpired && !bypass) {
        return new Response(buildExpiredDemoHtml(resolvedClient), {
          status: 403,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'X-Robots-Tag': 'noindex, nofollow'
          }
        });
      }

      let finalHtml = ensureClientHtmlSeoTags(rawHtml, resolvedClient, url, isPathDemo, cleanSlug);
      if (!isLiveDomain && (!resolvedClient || resolvedClient.stage !== 'launched' || forceBar)) {
        finalHtml = injectClaimBarIntoHtml(finalHtml, resolvedClient || { businessName: slug, demoSlug: cleanSlug });
      }
      return new Response(finalHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }
  }

  // 2. Per-Client /robots.txt (Google Search Console ready)
  if (reqPath === '/robots.txt') {
    if (env && env.WYNN_KV && cleanSlug) {
      const customRobots = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/robots.txt`, 'text');
      if (customRobots) {
        return new Response(customRobots, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
        });
      }
    }
    return new Response(buildClientRobotsTxt(baseOrigin), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
    });
  }

  // 3. Per-Client /sitemap.xml (Google Search Console ready)
  if (reqPath === '/sitemap.xml') {
    if (env && env.WYNN_KV && cleanSlug) {
      const customSitemap = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/sitemap.xml`, 'text');
      if (customSitemap) {
        return new Response(customSitemap, {
          status: 200,
          headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
        });
      }
      const meta = await env.WYNN_KV.get(`site_meta:${cleanSlug}`, 'json').catch(() => null);
      return new Response(buildClientSitemapXml(baseOrigin, meta), {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
      });
    }
    return new Response(buildClientSitemapXml(baseOrigin, null), {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
    });
  }

  // 4. Per-Client Bespoke Favicon (/favicon.svg, /favicon.png, /favicon.ico, /apple-touch-icon.png)
  if (
    reqPath === '/favicon.svg' ||
    reqPath === '/favicon.png' ||
    reqPath === '/favicon.ico' ||
    reqPath === '/apple-touch-icon.png'
  ) {
    if (env && env.WYNN_KV && cleanSlug) {
      const directObj = await env.WYNN_KV.getWithMetadata(`site_asset:${cleanSlug}:${reqPath}`, 'arrayBuffer');
      if (directObj && directObj.value) {
        const mime = (directObj.metadata && directObj.metadata.mimeType) || getMimeType(reqPath);
        return new Response(directObj.value, {
          status: 200,
          headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=0, must-revalidate' }
        });
      }
      if (reqPath !== '/favicon.svg') {
        const pngFallback = await env.WYNN_KV.getWithMetadata(`site_asset:${cleanSlug}:/favicon.png`, 'arrayBuffer');
        if (pngFallback && pngFallback.value) {
          return new Response(pngFallback.value, {
            status: 200,
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=0, must-revalidate' }
          });
        }
      }
      const svgStored = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/favicon.svg`, 'text');
      if (svgStored) {
        return new Response(svgStored, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=0, must-revalidate' }
        });
      }
    }
    const meta = (env && env.WYNN_KV && cleanSlug)
      ? await env.WYNN_KV.get(`site_meta:${cleanSlug}`, 'json').catch(() => null)
      : null;
    const resolvedClient = client || ((!meta || !meta.businessName) && stripeSecretKey ? await findCustomerBySlugOrId(slug, stripeSecretKey) : null);
    const bizName = (meta && meta.businessName) || (resolvedClient && (resolvedClient.businessName || resolvedClient.name)) || slug || 'Atelier';
    const palette = (meta && meta.palette) || '01';
    return new Response(buildClientMonogramFaviconSvg(bizName, palette), {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' }
    });
  }

  // 5. Per-Client Social Share Image (/og-share.jpg -> 1200x630 JPEG)
  if (reqPath === '/og-share.jpg') {
    let meta = null;
    if (env && env.WYNN_KV && cleanSlug) {
      const ogObj = await env.WYNN_KV.getWithMetadata(`site_asset:${cleanSlug}:/og-share.jpg`, 'arrayBuffer');
      if (ogObj && ogObj.value) {
        return new Response(ogObj.value, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' }
        });
      }
      meta = await env.WYNN_KV.get(`site_meta:${cleanSlug}`, 'json').catch(() => null);
    }
    // Palette-matched oil-painting JPEG fallback so social shares never 404
    const pal = (meta && ['02', '03', '04', '05'].includes(meta.palette)) ? meta.palette : '01';
    const fallbackAssetPath = pal === '01' ? '/assets/atelier/nails/hero-sanctuary.jpg' : `/assets/atelier/nails/p${pal}/hero.jpg`;
    const fallbackUrl = new URL(fallbackAssetPath, 'https://wynnpages.com.au');
    if (env && env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(new Request(fallbackUrl.toString()));
      if (assetRes.ok) {
        return new Response(assetRes.body, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' }
        });
      }
    }
    return Response.redirect(`https://wynnpages.com.au${fallbackAssetPath}`, 302);
  }

  // 6. Standard KV static assets
  if (env && env.WYNN_KV && cleanSlug) {
    const assetObj = await env.WYNN_KV.getWithMetadata(`site_asset:${cleanSlug}:${reqPath}`, 'arrayBuffer');
    if (assetObj && assetObj.value) {
      const mimeType = (assetObj.metadata && assetObj.metadata.mimeType) || getMimeType(reqPath);
      return new Response(assetObj.value, {
        status: 200,
        headers: { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=0, must-revalidate' }
      });
    }
  }

  return null;
}

async function uploadStripeFile(fileObj, stripeSecretKey) {
  if (!fileObj || !fileObj.dataUrl || typeof fileObj.dataUrl !== 'string') {
    return null;
  }
  try {
    const matches = fileObj.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;
    const mimeType = matches[1] || 'application/octet-stream';
    const base64Data = matches[2];
    const binaryStr = atob(base64Data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const formData = new FormData();
    formData.append('purpose', 'dispute_evidence');
    const blob = new Blob([bytes], { type: mimeType });
    formData.append('file', blob, fileObj.name || 'upload.bin');

    const res = await fetch('https://files.stripe.com/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`
      },
      body: formData
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id || null;
  } catch (e) {
    return null;
  }
}

async function uploadGoogleDriveFile(fileObj, folderName, webhookUrl) {
  if (!webhookUrl || !fileObj || !fileObj.dataUrl || typeof fileObj.dataUrl !== 'string') {
    return null;
  }
  try {
    const matches = fileObj.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return null;
    const mimeType = matches[1] || 'application/octet-stream';
    const base64Data = matches[2];
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderName: folderName || 'WynnPages Client Assets',
        fileName: fileObj.name || 'upload.bin',
        mimeType,
        base64Data
      })
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return {
      fileUrl: data.fileUrl || data.url || '',
      folderUrl: data.folderUrl || ''
    };
  } catch (e) {
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

const DEFAULT_CF_NAMESERVERS = 'olga.ns.cloudflare.com, toby.ns.cloudflare.com';

async function getValidCloudflareToken(env, forceRefresh = false, tokenOverride = '') {
  if (tokenOverride && tokenOverride.trim()) return tokenOverride.trim();
  if (env && env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_API_TOKEN.trim()) {
    return env.CLOUDFLARE_API_TOKEN.trim();
  }
  if (!env || !env.WYNN_KV) return null;

  const directToken = await env.WYNN_KV.get('cf_api_token');
  if (directToken && directToken.trim()) return directToken.trim();

  let state = await env.WYNN_KV.get('cf_oauth_state', 'json').catch(() => null);
  if (!state || !state.accessToken) return null;

  const isStale = !state.updatedAt || (Date.now() - state.updatedAt > 30 * 60 * 1000);
  if ((forceRefresh || isStale) && state.refreshToken) {
    try {
      const tokenParams = new URLSearchParams();
      tokenParams.append('grant_type', 'refresh_token');
      tokenParams.append('refresh_token', state.refreshToken);
      tokenParams.append('client_id', '54d11594-84e4-41aa-b438-e81b8fa78ee7');
      const refreshRes = await fetch('https://dash.cloudflare.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString()
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json().catch(() => ({}));
        if (refreshData.access_token) {
          state = {
            accessToken: refreshData.access_token,
            refreshToken: refreshData.refresh_token || state.refreshToken,
            updatedAt: Date.now()
          };
          await env.WYNN_KV.put('cf_oauth_state', JSON.stringify(state));
        }
      }
    } catch (_) { }
  }
  return state.accessToken ? state.accessToken.trim() : null;
}

async function removeCloudflareWorkerDomain(rawHostname, env, tokenOverride = '') {
  const host = rawHostname.includes('.') ? rawHostname : `${slugifyName(rawHostname)}.wynnpages.com.au`;
  if (!host || host === 'wynnpages.com.au' || host === 'www.wynnpages.com.au') return false;
  const accountId = '8daebe5da641a8b2fc3185586ba888e2';

  try {
    let accessToken = await getValidCloudflareToken(env, false, tokenOverride);
    if (!accessToken) return false;

    async function tryList(token) {
      return fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }

    let res = await tryList(accessToken);
    if (!res.ok) {
      accessToken = await getValidCloudflareToken(env, true, tokenOverride);
      if (accessToken) res = await tryList(accessToken);
    }

    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    const domains = data.result || [];
    const match = domains.find(d => d.hostname === host);
    if (match && match.id) {
      const delRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains/${match.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      return delRes.ok;
    }
  } catch (e) {
    // Non-blocking
  }
  return false;
}

async function ensureCloudflareSubdomain(rawSlug, env, tokenOverride = '') {
  const slug = slugifyName(rawSlug);
  if (!slug || slug === 'www' || !env || !env.WYNN_KV) return false;
  const hostname = `${slug}.wynnpages.com.au`;
  const accountId = '8daebe5da641a8b2fc3185586ba888e2';
  const zoneId = '51b59bcb624848db459c145765a5b108';

  try {
    const alreadyDone = await env.WYNN_KV.get(`sub_${slug}`);
    if (alreadyDone === '1') return true;

    let accessToken = await getValidCloudflareToken(env, false, tokenOverride);
    if (!accessToken) return false;

    async function tryAttach(token) {
      return fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          zone_id: zoneId,
          hostname,
          service: 'wynnpages',
          environment: 'production'
        })
      });
    }

    let res = await tryAttach(accessToken);
    if (!res.ok) {
      accessToken = await getValidCloudflareToken(env, true, tokenOverride);
      if (accessToken) res = await tryAttach(accessToken);
    }

    if (res.ok) {
      await env.WYNN_KV.put(`sub_${slug}`, '1');
      return true;
    }
  } catch (e) {
    // Non-blocking
  }
  return false;
}

async function ensureCustomLiveDomainOnCloudflare(rawDomain, env, tokenOverride = '') {
  const rootDomain = extractCleanHost(rawDomain);
  if (
    !rootDomain ||
    !rootDomain.includes('.') ||
    rootDomain.endsWith('wynnpages.com.au') ||
    rootDomain.endsWith('pages.dev') ||
    rootDomain.endsWith('workers.dev') ||
    !env ||
    !env.WYNN_KV
  ) {
    return { attached: false, reason: 'skipped' };
  }

  const accountId = '8daebe5da641a8b2fc3185586ba888e2';
  try {
    let accessToken = await getValidCloudflareToken(env, false, tokenOverride);
    if (!accessToken) {
      return {
        attached: false,
        reason: 'no_token',
        rootDomain,
        nameservers: DEFAULT_CF_NAMESERVERS
      };
    }

    let zoneRes = await fetch(
      `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(rootDomain)}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );
    if (!zoneRes.ok) {
      accessToken = await getValidCloudflareToken(env, true, tokenOverride);
      if (accessToken) {
        zoneRes = await fetch(
          `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(rootDomain)}`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
      }
    }
    const zoneData = await zoneRes.json().catch(() => ({}));
    let zoneObj = zoneData.result && zoneData.result[0];

    // If the client's domain is not in Cloudflare yet, automatically add the Zone to Cloudflare!
    if (!zoneObj || !zoneObj.id) {
      let createZoneRes = await fetch('https://api.cloudflare.com/client/v4/zones', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: rootDomain,
          account: { id: accountId },
          type: 'full'
        })
      });
      if (!createZoneRes.ok) {
        accessToken = await getValidCloudflareToken(env, true, tokenOverride);
        if (accessToken) {
          createZoneRes = await fetch('https://api.cloudflare.com/client/v4/zones', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: rootDomain,
              account: { id: accountId },
              type: 'full'
            })
          });
        }
      }
      const createZoneData = await createZoneRes.json().catch(() => ({}));
      if (createZoneData && createZoneData.result && createZoneData.result.id) {
        zoneObj = createZoneData.result;
      }
    }

    if (!zoneObj || !zoneObj.id) {
      return {
        attached: false,
        reason: 'zone_pending_registration',
        rootDomain,
        nameservers: DEFAULT_CF_NAMESERVERS
      };
    }

    const nameservers = (Array.isArray(zoneObj.name_servers) && zoneObj.name_servers.length)
      ? zoneObj.name_servers.join(', ')
      : DEFAULT_CF_NAMESERVERS;
    const hostnames = [rootDomain, `www.${rootDomain}`];
    for (const h of hostnames) {
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          zone_id: zoneObj.id,
          hostname: h,
          service: 'wynnpages',
          environment: 'production'
        })
      });
    }
    await env.WYNN_KV.put(`livedom_${rootDomain}`, '1');
    return {
      attached: true,
      rootDomain,
      zoneId: zoneObj.id,
      zoneStatus: zoneObj.status || 'pending',
      nameservers
    };
  } catch (e) {
    return {
      attached: false,
      reason: e.message,
      rootDomain,
      nameservers: DEFAULT_CF_NAMESERVERS
    };
  }
}

async function findStripeCustomerByEmail(email, stripeSecretKey) {
  if (!email) return null;
  const res = await fetch(
    `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,
    {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
    }
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.data && data.data.length > 0 ? data.data[0] : null;
}

function getIndustryNicheTerms(industry) {
  const ind = (industry || '').toLowerCase();
  if (/(nail|beauty|hair|barber|lash|spa|massage|skin|wellness)/.test(ind)) {
    return { noun: 'salon', sponsorship: 'Atelier Sponsorship' };
  }
  if (/(cafe|coffee|restaurant|bakery|bar|bistro|dining|eatery|pizza)/.test(ind)) {
    return { noun: 'venue', sponsorship: 'Studio Sponsorship' };
  }
  if (/(plumb|electr|tradie|builder|paint|carpenter|roof|cleaning|solar|hvac|landscap)/.test(ind)) {
    return { noun: 'business', sponsorship: 'Studio Sponsorship' };
  }
  if (/(clinic|dental|chiro|physio|health|medical|doctor|vet)/.test(ind)) {
    return { noun: 'practice', sponsorship: 'Studio Sponsorship' };
  }
  if (/(boutique|fashion|retail|store|shop|florist)/.test(ind)) {
    return { noun: 'boutique', sponsorship: 'Studio Sponsorship' };
  }
  return { noun: 'business', sponsorship: 'Studio Sponsorship' };
}

async function runScheduledAutopilot(env, options = {}) {
  const force = Boolean(options.force);
  const { cfg } = await loadSyncedRuntime(env);
  if (!cfg.stripeSecretKey) {
    return { ok: false, error: 'Chưa cấu hình Stripe API Key' };
  }

  let settings = { enabled: true, autoSms: true, autoDeal: true, autoExpire: true };
  const dbAp = getD1(env);
  if (dbAp) {
    await ensureD1Schema(env);
    const apRow = await dbAp.prepare('SELECT value FROM settings WHERE key = ?').bind('studio_autopilot_settings').first().catch(() => null);
    if (apRow && apRow.value) {
      try { settings = { ...settings, ...JSON.parse(apRow.value) }; } catch (_) {}
    } else if (env && env.WYNN_KV) {
      const saved = await env.WYNN_KV.get('studio_autopilot_settings', 'json').catch(() => null);
      if (saved && typeof saved === 'object') {
        settings = { ...settings, ...saved };
        await dbAp.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING')
          .bind('studio_autopilot_settings', JSON.stringify(settings), new Date().toISOString()).run().catch(() => {});
      }
    }
  } else if (env && env.WYNN_KV) {
    const saved = await env.WYNN_KV.get('studio_autopilot_settings', 'json').catch(() => null);
    if (saved && typeof saved === 'object') {
      settings = { ...settings, ...saved };
    }
  }

  if (!settings.enabled && !force) {
    return { ok: true, skipped: true, reason: 'Cloud Autopilot đang tắt' };
  }

  let allCustomers = [];
  try {
    let hasMore = true;
    let startingAfter = null;
    while (hasMore && allCustomers.length < 250) {
      let fetchUrl = 'https://api.stripe.com/v1/customers?limit=100';
      if (startingAfter) fetchUrl += `&starting_after=${encodeURIComponent(startingAfter)}`;
      const cRes = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
      });
      if (!cRes.ok) break;
      const cData = await cRes.json();
      const list = Array.isArray(cData.data) ? cData.data : [];
      allCustomers.push(...list);
      hasMore = cData.has_more && list.length > 0;
      if (list.length > 0) startingAfter = list[list.length - 1].id;
    }
  } catch (err) {
    return { ok: false, error: `Failed to fetch Stripe customers: ${err.message}` };
  }

  const reports = [];
  const updatedClients = [];
  let smsSentCount = 0;
  let dealActivatedCount = 0;
  let expiredCount = 0;
  let scannedCount = 0;

  async function patchCustAndSync(custId, uP) {
    const pRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(custId)}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: uP.toString()
    }).catch(() => null);
    if (pRes && pRes.ok) {
      const updated = formatCustomerRecord(await pRes.json());
      if (updated) {
        await upsertD1Client(env, updated);
        updatedClients.push(updated);
      }
      return updated;
    }
    return null;
  }

  for (const rawCust of allCustomers) {
    const c = formatCustomerRecord(rawCust);
    if (!c) continue;
    const isOutbound = c.source === 'admin_lead_hunter' || c.source === 'outbound_admin' || c.outboundPitched || c.isOutboundLead || Boolean(c.demoUrl || c.brandedDemoUrl);
    const isPaid = c.paymentStatus === 'paid' || c.stage === 'launched' || c.stage === 'site_launched' || Boolean(c.launchedAt);
    if (!isOutbound || isPaid) continue;
    const isTurbo = c.turboTestMode === true;
    if (c.nurtureAutoEnabled === false && !isTurbo) continue;

    const sentTime = c.sequenceStartedAt || c.demoSentAt || c.fbPitchedAt;
    if (!sentTime) continue;

    scannedCount++;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const sentTimeMs = typeof sentTime === 'number' ? (sentTime < 1e11 ? sentTime * 1000 : sentTime) : new Date(sentTime).getTime();
    if (!sentTimeMs || isNaN(sentTimeMs)) continue;
    const elapsedMs = Math.max(0, now - sentTimeMs);
    const daysElapsed = elapsedMs / (1000 * 3600 * 24);
    const minsElapsed = elapsedMs / (1000 * 60);
    const biz = c.businessName || c.name || 'Boutique';
    const demoUrl = c.demoUrl || c.brandedDemoUrl || (c.demoSlug ? `https://${c.demoSlug}.wynnpages.com.au` : `https://${c.id}.wynnpages.com.au`);
    const isFbMode = c.channelMode === 'facebook' || !c.phone;
    const alertedList = String(c.fbAlertedSteps || '').split(',').map(s => s.trim()).filter(Boolean);

    const parseMs = (val) => {
      if (!val) return 0;
      const t = typeof val === 'number' ? (val < 1e11 ? val * 1000 : val) : new Date(val).getTime();
      return (t && !isNaN(t)) ? t : 0;
    };
    const rawStep2Ms = parseMs(c.step2SentAt);
    const rawStep3Ms = parseMs(c.step3SentAt || c.dealActivatedAt);
    const rawStep4Ms = parseMs(c.step4SentAt);

    // Ignore stale step timestamps from an older test cycle if sequenceStartedAt was restarted more recently
    const step2SentMs = (rawStep2Ms && rawStep2Ms >= sentTimeMs - 5000) ? rawStep2Ms : 0;
    const step3SentMs = (rawStep3Ms && rawStep3Ms >= sentTimeMs - 5000) ? rawStep3Ms : 0;
    const step4SentMs = (rawStep4Ms && rawStep4Ms >= sentTimeMs - 5000) ? rawStep4Ms : 0;

    const step2Done = Boolean(step2SentMs) || c.nurtureStep === 'day3_reminder' || c.nurtureStep === 'aussie_followup_views' || c.nurtureStep === 'followup_views' || (isFbMode && alertedList.includes('day3'));
    const step3Done = Boolean(step3SentMs) || (c.dealStatus === 'flash_deal' && (!isFbMode || c.nurtureStep === 'day7_deal_active' || alertedList.includes('day6'))) || c.nurtureStep === 'aussie_flash_deal_299';
    const step4Done = Boolean(step4SentMs) || c.nurtureStep === 'day9_warning' || (isFbMode && alertedList.includes('day9'));
    let step5Done = Boolean(c.step5LockedAt) || c.dealStatus === 'expired' || c.dealStatus === 'purged';

    // 0. Auto-Heal Step-Skipping Bug: If a client (e.g. cus_VVRo44StsdaaN / cafe) jumped to Step 5 expired before Steps 2, 3, or 4 were sent, reset its prematurely locked state so the sequence runs sequentially
    const skippedPriorSteps = !step2Done || !step3Done || !step4Done;
    if (
      c.dealStatus !== 'purged' &&
      skippedPriorSteps &&
      (step5Done || c.nurtureStep === 'demo_expired' || c.nurtureStep === 'done_expired' || c.id === 'cus_VVRo44StsdaaN' || c.demoSlug === 'cafe')
    ) {
      if (step5Done || c.nurtureStep === 'demo_expired' || c.nurtureStep === 'done_expired') {
        const healParams = new URLSearchParams();
        const restoredDealStatus = step3Done ? 'flash_deal' : 'standard';
        const restoredNurtureStep = step4Done
          ? 'day9_warning'
          : (step3Done ? 'day7_deal_active' : (step2Done ? 'day3_reminder' : 'aussie_pitch'));
        healParams.append('metadata[deal_status]', restoredDealStatus);
        healParams.append('metadata[step5_locked_at]', '');
        healParams.append('metadata[deal_expires_at]', step3Done ? new Date(now + 72 * 3600 * 1000).toISOString() : '');
        healParams.append('metadata[nurture_step]', restoredNurtureStep);
        await patchCustAndSync(c.id, healParams);
        c.dealStatus = restoredDealStatus;
        c.step5LockedAt = '';
        c.nurtureStep = restoredNurtureStep;
        step5Done = false;
        reports.push(`[Auto-Heal] Khôi phục trạng thái nhảy cóc Step 5 cho: ${biz}`);
      }
    }

    // 1. Step 2: Day 3 / T+15m (Follow-up) — MUST run first if unsent!
    const step2Due = !step2Done && (isTurbo ? minsElapsed >= 15 : daysElapsed >= 2.6);
    if (step2Due && c.dealStatus !== 'expired' && c.dealStatus !== 'purged') {
      const cleanSlugD3 = slugifyName(c.demoSlug || c.businessName || c.name || '');
      let d3Views = Number(c.demoViewCount || 0);
      if (dbAp) {
        const r3 = await dbAp.prepare('SELECT view_count FROM clients WHERE id = ?').bind(c.id).first().catch(() => null);
        if (r3 && r3.view_count) d3Views = Math.max(d3Views, Number(r3.view_count));
      }
      if (env && env.WYNN_KV && cleanSlugD3) {
        const kv3 = await env.WYNN_KV.get(`demo_views:${cleanSlugD3}`, 'json').catch(() => null);
        if (kv3 && kv3.viewCount) d3Views = Math.max(d3Views, Number(kv3.viewCount));
      }

      if (isFbMode) {
        if (c.fbDueStep !== 'day3' || !alertedList.includes('day3')) {
          const nextAlerted = Array.from(new Set([...alertedList, 'day3'])).join(',');
          const uP = new URLSearchParams();
          uP.append('metadata[fb_due_step]', 'day3');
          uP.append('metadata[fb_alerted_steps]', nextAlerted);
          uP.append('metadata[step2_sent_at]', nowIso);
          await patchCustAndSync(c.id, uP);
          if (!alertedList.includes('day3')) {
            await recordStudioActivity(env, {
              type: 'fb_due_day3',
              icon: '💬',
              title: `Đến Hạn Gửi FB Bước 2 (Hỏi Thăm): ${biz}`,
              message: `Đã đến ${isTurbo ? 'phút 15 (Test)' : 'Ngày 3'} cho khách Facebook "${biz}" (${d3Views} lượt xem Demo). Mở Admin bấm vào Bước 2 đang sáng xanh để Copy lời hỏi thăm & mở Messenger!`,
              clientName: biz,
              slug: c.demoSlug || ''
            }, options.ctx);
          }
          reports.push(`[${isTurbo ? 'Phút 15' : 'Ngày 3'} - FB] Nhắc Admin gửi FB hỏi thăm (${d3Views} views): ${biz}`);
        }
        continue;
      } else if ((settings.autoSms || force || isTurbo) && ((c.phone && cfg.clicksendApiKey) || (c.email && cfg.resendApiKey))) {
        const reminderMsg = buildNurtureStepSms({ stepKey: 'step2', biz, demoUrl, views: d3Views });
        let smsRes = { sent: false, reason: c.phone ? 'Chưa cấu hình ClickSend' : 'Chưa có SĐT' };
        if (c.phone && cfg.clicksendApiKey) {
          smsRes = await sendClickSendSms(c.phone, reminderMsg, cfg);
        }
        let emailSent = false;
        let emailRes = { sent: false, reason: c.email ? 'Chưa cấu hình Resend' : 'Chưa có Email' };
        let mailPayload = null;
        if (c.email && cfg.resendApiKey) {
          mailPayload = buildNurtureStepEmail({ stepKey: 'step2', client: c, demoUrl, views: d3Views });
          if (mailPayload) {
            const mRes = await sendResendEmail({ to: c.email, subject: mailPayload.subject, html: mailPayload.html, cfg }).catch((e) => ({ sent: false, reason: e.message }));
            if (mRes) emailRes = mRes;
            emailSent = Boolean(mRes && mRes.sent);
          }
        }
        const uP = new URLSearchParams();
        uP.append('metadata[nurture_step]', 'day3_reminder');
        uP.append('metadata[step2_sent_at]', nowIso);
        uP.append('metadata[fb_due_step]', '');
        if (c.phone && smsRes) uP.append('metadata[last_sms_log]', `${smsRes.sent ? 'OK' : 'ERR'} (${c.phone}) [day3_reminder] @ ${nowIso}`.slice(0, 480));
        if (emailSent) uP.append('metadata[last_email_log]', `OK (${c.email}) [day3_reminder] @ ${nowIso}`.slice(0, 480));
        await patchCustAndSync(c.id, uP);
        if (c.phone) {
          await recordSmsHistory({
            customerId: c.id,
            env,
            stripeSecretKey: cfg.stripeSecretKey,
            type: 'day3_reminder',
            to: c.phone,
            text: reminderMsg,
            status: smsRes.sent,
            reason: smsRes.reason
          });
        }
        await notifyTelegramAutomatedComms({
          env,
          ctx: options.ctx || null,
          client: c,
          triggerType: 'autopilot_step2',
          icon: isTurbo ? '⚡' : '🤖',
          title: `${isTurbo ? '⚡ [TURBO T+15p - BƯỚC 2]' : '🤖 [AUTOPILOT NGÀY 3 - BƯỚC 2]'} Đã gửi chăm sóc: ${biz}`,
          views: d3Views,
          smsSent: Boolean(smsRes && smsRes.sent),
          smsSkippedReason: smsRes && smsRes.reason,
          smsTo: (smsRes && smsRes.to) || c.phone,
          smsText: reminderMsg,
          emailSent,
          emailSkippedReason: emailRes && emailRes.reason,
          emailTo: c.email,
          emailSubject: (mailPayload && mailPayload.subject) || '',
          waitForTelegram: true
        });
        if (smsRes.sent) smsSentCount++;
        reports.push(`[${isTurbo ? 'Phút 15' : 'Ngày 3'}] Gửi SMS${emailSent ? '+Email' : ''} Hỏi thăm (${d3Views} views): ${biz}`);
        continue;
      }
    }

    // 2. Step 3: Day 6 / T+30m (Flash Deal 50% $299 AUD / 72h Activation) — ONLY after Step 2 is done!
    const minsSinceStep2 = step2SentMs ? (now - step2SentMs) / (1000 * 60) : minsElapsed;
    const daysSinceStep2 = step2SentMs ? (now - step2SentMs) / (1000 * 3600 * 24) : daysElapsed;
    const step3Due = step2Done && !step3Done && (
      isTurbo
        ? (step2SentMs ? minsSinceStep2 >= 15 : minsElapsed >= 30)
        : (step2SentMs ? daysSinceStep2 >= 2.6 : daysElapsed >= 5.6)
    );
    if (step3Due && c.dealStatus !== 'expired' && c.dealStatus !== 'purged') {
      if (settings.autoDeal || force || isTurbo) {
        const dealExpiresAt = new Date(now + 72 * 3600 * 1000).toISOString();
        const uP = new URLSearchParams();
        uP.append('metadata[deal_status]', 'flash_deal');
        uP.append('metadata[deal_activated_at]', nowIso);
        uP.append('metadata[deal_expires_at]', dealExpiresAt);
        uP.append('metadata[step3_sent_at]', nowIso);

        if (isFbMode) {
          const nextAlerted = Array.from(new Set([...alertedList, 'day6'])).join(',');
          uP.append('metadata[fb_due_step]', 'day6');
          uP.append('metadata[fb_alerted_steps]', nextAlerted);
          await patchCustAndSync(c.id, uP);
          dealActivatedCount++;
          if (!alertedList.includes('day6')) {
            await recordStudioActivity(env, {
              type: 'fb_due_day6',
              icon: '⚡',
              title: `Đã Hạ Giá $299 & Đến Hạn Gửi FB Bước 3: ${biz}`,
              message: `Web Demo của "${biz}" đã tự động giảm xuống $299 AUD (72h). Mở Admin bấm vào Bước 3 đang sáng xanh để Copy lời chào Deal 50% & gửi qua Messenger!`,
              clientName: biz,
              slug: c.demoSlug || '',
              waitForTelegram: true
            }, options.ctx);
          }
          reports.push(`[${isTurbo ? 'Phút 30' : 'Ngày 6'} - FB] Hạ Demo $299 AUD (72h) + Nhắc Admin gửi FB: ${biz}`);
          continue;
        }

        uP.append('metadata[nurture_step]', 'day7_deal_active');
        uP.append('metadata[fb_due_step]', '');
        let smsSent = false;
        let dealMsg = buildNurtureStepSms({ stepKey: 'step3', biz, demoUrl });
        let smsRes = { sent: false, reason: c.phone ? 'Chưa cấu hình ClickSend' : 'Chưa có SĐT' };
        if ((settings.autoSms || force || isTurbo) && c.phone && cfg.clicksendApiKey) {
          smsRes = await sendClickSendSms(c.phone, dealMsg, cfg);
          smsSent = Boolean(smsRes && smsRes.sent);
          if (smsSent) smsSentCount++;
          if (smsRes) uP.append('metadata[last_sms_log]', `${smsRes.sent ? 'OK' : 'ERR'} (${c.phone}) [day7_deal] @ ${nowIso}`.slice(0, 480));
        }
        let emailSent = false;
        let emailRes = { sent: false, reason: c.email ? 'Chưa cấu hình Resend' : 'Chưa có Email' };
        let mailPayload = null;
        if (c.email && cfg.resendApiKey) {
          mailPayload = buildNurtureStepEmail({ stepKey: 'step3', client: c, demoUrl });
          if (mailPayload) {
            const mRes = await sendResendEmail({ to: c.email, subject: mailPayload.subject, html: mailPayload.html, cfg }).catch((e) => ({ sent: false, reason: e.message }));
            if (mRes) emailRes = mRes;
            emailSent = Boolean(mRes && mRes.sent);
            if (emailSent) uP.append('metadata[last_email_log]', `OK (${c.email}) [day7_deal] @ ${nowIso}`.slice(0, 480));
          }
        }
        await patchCustAndSync(c.id, uP);
        if (c.phone && smsRes) {
          await recordSmsHistory({
            customerId: c.id,
            env,
            stripeSecretKey: cfg.stripeSecretKey,
            type: 'day7_deal',
            to: c.phone,
            text: dealMsg,
            status: smsRes.sent,
            reason: smsRes.reason
          });
        }
        await notifyTelegramAutomatedComms({
          env,
          ctx: options.ctx || null,
          client: c,
          triggerType: 'autopilot_step3_deal299',
          icon: '🔥',
          title: `${isTurbo ? '⚡ [TURBO T+30p - BƯỚC 3]' : '🔥 [AUTOPILOT NGÀY 6/7 - BƯỚC 3]'} Kích hoạt Deal $299 & gửi SMS/Email: ${biz}`,
          views: Number(c.demoViewCount || 0),
          smsSent,
          smsSkippedReason: smsRes && smsRes.reason,
          smsTo: (smsRes && smsRes.to) || c.phone,
          smsText: dealMsg,
          emailSent,
          emailSkippedReason: emailRes && emailRes.reason,
          emailTo: c.email,
          emailSubject: (mailPayload && mailPayload.subject) || '',
          extraNote: `Hết hạn Flash Deal $299 AUD lúc: ${formatAuDateTime(new Date(dealExpiresAt), AU_TIMEZONE)}`,
          waitForTelegram: true
        });
        dealActivatedCount++;
        reports.push(`[${isTurbo ? 'Phút 30' : 'Ngày 6'}] Kích hoạt Deal 50% ($299 AUD / 72h)${smsSent ? ' + gửi SMS' : ''}${emailSent ? '+Email' : ''}: ${biz}`);
        continue;
      }
    }

    // 3. Step 4: Day 9 / T+45m (24h Final Warning) — ONLY after Steps 2 & 3 are done!
    const minsSinceStep3 = step3SentMs ? (now - step3SentMs) / (1000 * 60) : minsElapsed;
    const daysSinceStep3 = step3SentMs ? (now - step3SentMs) / (1000 * 3600 * 24) : daysElapsed;
    const step4Due = step2Done && step3Done && !step4Done && (
      isTurbo
        ? (step3SentMs ? minsSinceStep3 >= 15 : minsElapsed >= 45)
        : (step3SentMs ? daysSinceStep3 >= 2.5 : daysElapsed >= 8.6)
    );
    if (step4Due && c.dealStatus !== 'expired' && c.dealStatus !== 'purged') {
      if (isFbMode) {
        if (c.fbDueStep !== 'day9' || !alertedList.includes('day9')) {
          const nextAlerted = Array.from(new Set([...alertedList, 'day9'])).join(',');
          const uP = new URLSearchParams();
          uP.append('metadata[fb_due_step]', 'day9');
          uP.append('metadata[fb_alerted_steps]', nextAlerted);
          uP.append('metadata[step4_sent_at]', nowIso);
          await patchCustAndSync(c.id, uP);
          if (!alertedList.includes('day9')) {
            await recordStudioActivity(env, {
              type: 'fb_due_day9',
              icon: '💬',
              title: `Đến Hạn Gửi FB Bước 4 (24h Cuối): ${biz}`,
              message: `Đã đến ${isTurbo ? 'phút 45 (Test)' : 'Ngày 9'} cho khách Facebook "${biz}". Mở Admin bấm vào Bước 4 đang sáng xanh để Copy tin nhắc 24h cuối & mở Messenger!`,
              clientName: biz,
              slug: c.demoSlug || '',
              waitForTelegram: true
            }, options.ctx);
          }
          reports.push(`[${isTurbo ? 'Phút 45' : 'Ngày 9'} - FB] Nhắc Admin gửi tin 24h cuối: ${biz}`);
        }
        continue;
      } else if ((settings.autoSms || force || isTurbo) && ((c.phone && cfg.clicksendApiKey) || (c.email && cfg.resendApiKey))) {
        const warningMsg = buildNurtureStepSms({ stepKey: 'step4', biz, demoUrl });
        let smsRes = { sent: false, reason: c.phone ? 'Chưa cấu hình ClickSend' : 'Chưa có SĐT' };
        if (c.phone && cfg.clicksendApiKey) {
          smsRes = await sendClickSendSms(c.phone, warningMsg, cfg);
        }
        let emailSent = false;
        let emailRes = { sent: false, reason: c.email ? 'Chưa cấu hình Resend' : 'Chưa có Email' };
        let mailPayload = null;
        if (c.email && cfg.resendApiKey) {
          mailPayload = buildNurtureStepEmail({ stepKey: 'step4', client: c, demoUrl });
          if (mailPayload) {
            const mRes = await sendResendEmail({ to: c.email, subject: mailPayload.subject, html: mailPayload.html, cfg }).catch((e) => ({ sent: false, reason: e.message }));
            if (mRes) emailRes = mRes;
            emailSent = Boolean(mRes && mRes.sent);
          }
        }
        const uP = new URLSearchParams();
        uP.append('metadata[nurture_step]', 'day9_warning');
        uP.append('metadata[step4_sent_at]', nowIso);
        uP.append('metadata[fb_due_step]', '');
        if (c.phone && smsRes) uP.append('metadata[last_sms_log]', `${smsRes.sent ? 'OK' : 'ERR'} (${c.phone}) [day9_warning] @ ${nowIso}`.slice(0, 480));
        if (emailSent) uP.append('metadata[last_email_log]', `OK (${c.email}) [day9_warning] @ ${nowIso}`.slice(0, 480));
        await patchCustAndSync(c.id, uP);
        if (c.phone) {
          await recordSmsHistory({
            customerId: c.id,
            env,
            stripeSecretKey: cfg.stripeSecretKey,
            type: 'day9_warning',
            to: c.phone,
            text: warningMsg,
            status: smsRes.sent,
            reason: smsRes.reason
          });
        }
        await notifyTelegramAutomatedComms({
          env,
          ctx: options.ctx || null,
          client: c,
          triggerType: 'autopilot_step4_warning',
          icon: '⏳',
          title: `${isTurbo ? '⚡ [TURBO T+45p - BƯỚC 4]' : '⏳ [AUTOPILOT NGÀY 9 - BƯỚC 4]'} Cảnh báo 24h cuối: ${biz}`,
          views: Number(c.demoViewCount || 0),
          smsSent: Boolean(smsRes && smsRes.sent),
          smsSkippedReason: smsRes && smsRes.reason,
          smsTo: (smsRes && smsRes.to) || c.phone,
          smsText: warningMsg,
          emailSent,
          emailSkippedReason: emailRes && emailRes.reason,
          emailTo: c.email,
          emailSubject: (mailPayload && mailPayload.subject) || '',
          waitForTelegram: true
        });
        if (smsRes.sent) smsSentCount++;
        reports.push(`[${isTurbo ? 'Phút 45' : 'Ngày 9'}] Gửi SMS${emailSent ? '+Email' : ''} Cảnh báo 24h cuối: ${biz}`);
        continue;
      }
    }

    // 4. Step 5: Day 10+ / T+60m (Hard Expire Demo) — ONLY after Steps 2, 3, and 4 have all been sent!
    const minsSinceStep4 = step4SentMs ? (now - step4SentMs) / (1000 * 60) : minsElapsed;
    const daysSinceStep4 = step4SentMs ? (now - step4SentMs) / (1000 * 3600 * 24) : daysElapsed;
    const hasActiveSelfUnlockWindow = (c.nurtureStep === 'self_unlocked_48h' || c.nurtureStep === 'restored') && c.dealExpiresAt && new Date(c.dealExpiresAt).getTime() > now;
    const step5Due = step2Done && step3Done && step4Done && !step5Done && !hasActiveSelfUnlockWindow && (
      isTurbo
        ? (step4SentMs ? minsSinceStep4 >= 15 : minsElapsed >= 60)
        : (step4SentMs ? daysSinceStep4 >= 0.9 : daysElapsed >= 9.8)
    );
    if (step5Due) {
      if (settings.autoExpire || force || isTurbo) {
        const uP = new URLSearchParams();
        uP.append('metadata[deal_status]', 'expired');
        uP.append('metadata[deal_expires_at]', nowIso);
        uP.append('metadata[step5_locked_at]', nowIso);
        uP.append('metadata[nurture_step]', 'demo_expired');
        uP.append('metadata[fb_due_step]', '');
        await patchCustAndSync(c.id, uP);
        expiredCount++;
        await recordStudioActivity(env, {
          type: 'demo_expired',
          icon: '🔒',
          title: `Đã Khoá Demo Tự Động (${isTurbo ? 'Test 60p' : 'Ngày 10'}): ${biz}`,
          message: `Bản Demo (${demoUrl}) đã tự động khoá HTTP 403 sau khi kết thúc chu trình chốt sale.`,
          clientName: biz,
          slug: c.demoSlug || '',
          waitForTelegram: true
        }, options.ctx);
        reports.push(`[${isTurbo ? 'Phút 60' : `Ngày ${Math.round(daysElapsed)}`}] Khoá Demo 403: ${biz}`);
        continue;
      }
    }
  }

  if (updatedClients.length > 0) {
    runInBg(options.ctx, syncClientsKvSnapshot(env));
  }

  const lastRunRecord = {
    timestamp: new Date().toISOString(),
    scannedCount,
    smsSentCount,
    dealActivatedCount,
    expiredCount,
    reports: reports.slice(0, 50)
  };
  if (dbAp) {
    if (force || smsSentCount > 0 || dealActivatedCount > 0 || expiredCount > 0 || updatedClients.length > 0) {
      await dbAp.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind('studio_autopilot_last_run', JSON.stringify(lastRunRecord), new Date().toISOString()).run().catch(() => {});
    }
  } else if (env && env.WYNN_KV && (force || smsSentCount > 0 || dealActivatedCount > 0 || expiredCount > 0 || updatedClients.length > 0)) {
    await env.WYNN_KV.put('studio_autopilot_last_run', JSON.stringify(lastRunRecord)).catch(() => {});
  }

  return { ok: true, settings, lastRun: lastRunRecord, updatedClients };
}

let _lastBgSchedulerTickMs = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    // Handle CORS preflight globally (supports REST + Stripe webhook)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, stripe-signature'
        }
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, stripe-signature',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache'
    };

    const { cfg: syncedCfg } = await loadSyncedRuntime(env);
    let runtimeCreds = syncedCfg;
    const cfg = syncedCfg;

    // 1b. Background Auto-Scheduler Tick (throttled once per 60s via memory + D1 rate lock so scheduled SMS & 5-step sequence fire even when admin.html is closed)
    if (url.pathname !== '/api/run-scheduled-sms' && Date.now() - _lastBgSchedulerTickMs >= 60000) {
      _lastBgSchedulerTickMs = Date.now();
      runInBg(ctx, (async () => {
        try {
          const acquired = await acquireD1RateLock(env, 'bg_auto_scheduler_60s', 55);
          if (!acquired) return;
          await Promise.allSettled([
            processDueScheduledSms(env, ctx),
            runScheduledAutopilot(env, { force: false, fromPing: true, ctx })
          ]);
        } catch (_) {}
      })());
    }

    // 1a. Wildcard Subdomain Demo (`https://lushnailbar.wynnpages.com.au`), Clean Path (`/d/lushnailbar`), & Custom Official Client Domains
    const hostLower = url.hostname.toLowerCase();
    const isSubdomainDemo =
      hostLower.endsWith('.wynnpages.com.au') &&
      hostLower !== 'wynnpages.com.au' &&
      hostLower !== 'www.wynnpages.com.au';
    const isPathDemo = url.pathname.startsWith('/d/') && url.pathname.length > 3;
    const isCustomClientDomain =
      !hostLower.endsWith('wynnpages.com.au') &&
      !hostLower.endsWith('.workers.dev') &&
      !hostLower.endsWith('.pages.dev') &&
      hostLower !== 'localhost' &&
      hostLower !== '127.0.0.1';

    if (isCustomClientDomain && !url.pathname.startsWith('/api/')) {
      const liveClient = await findCustomerByLiveDomain(hostLower, cfg.stripeSecretKey);
      if (liveClient) {
        const reqPath = url.pathname === '/' || url.pathname === '' ? '/index.html' : url.pathname;
        if (liveClient.demoSlug) {
          const kvOrSeoRes = await serveClientSpecialSeoOrAsset({
            slug: liveClient.demoSlug,
            client: liveClient,
            reqPath,
            url,
            request,
            env,
            ctx,
            stripeSecretKey: cfg.stripeSecretKey,
            isLiveDomain: true,
            isPathDemo: false,
            forceBar: false
          });
          if (kvOrSeoRes) return kvOrSeoRes;
        }
        return serveLiveClientSite(liveClient, request, url);
      }
    }

    if ((isSubdomainDemo || isPathDemo) && !url.pathname.startsWith('/api/')) {
      let targetSlug = '';
      let reqPath = url.pathname;
      if (isSubdomainDemo) {
        targetSlug = hostLower.replace(/\.wynnpages\.com\.au$/i, '');
        if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
      } else {
        const sub = url.pathname.replace(/^\/d\//i, '');
        const firstSlash = sub.indexOf('/');
        if (firstSlash === -1) {
          targetSlug = sub;
          reqPath = '/index.html';
        } else {
          targetSlug = sub.slice(0, firstSlash);
          reqPath = sub.slice(firstSlash);
          if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
        }
      }

      const forceBar = url.searchParams.get('bar') === '1';
      const kvOrSeoRes = await serveClientSpecialSeoOrAsset({
        slug: targetSlug,
        client: null,
        reqPath,
        url,
        request,
        env,
        ctx,
        stripeSecretKey: cfg.stripeSecretKey,
        isLiveDomain: false,
        isPathDemo,
        forceBar
      });
      if (kvOrSeoRes) return kvOrSeoRes;

      // If not in KV, fall back to existing iframe preview for root
      if (reqPath === '/index.html' || reqPath === '/') {
        const client = await findCustomerBySlugOrId(targetSlug, cfg.stripeSecretKey);
        if (client) {
          if (client.stage === 'launched' && client.liveUrl && !forceBar) {
            const cleanLive = client.liveUrl.startsWith('http') ? client.liveUrl : `https://${client.liveUrl}`;
            return Response.redirect(cleanLive, 302);
          }
          const isPaid = (client.paymentStatus === 'paid' || client.stage === 'launched');
          const bypass = url.searchParams.get('preview') || url.searchParams.get('admin') || url.searchParams.get('unlocked');
          const isDealExpired = (client.dealStatus === 'expired' || client.dealStatus === 'purged');
          if (!isPaid && isDealExpired && !bypass) {
            return new Response(buildExpiredDemoHtml(client), {
              status: 403,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Robots-Tag': 'noindex, nofollow'
              }
            });
          }
          let html = '';
          if (client.stage === 'launched' && !forceBar) {
            html = buildCleanLiveHtml(client, url.origin);
          } else {
            const autoHtml = await hydrateAndStoreTemplateOnServer({
              env,
              requestUrl: url.toString(),
              client,
              templateKey: client.demoPalette
            });
            if (autoHtml) {
              const seoHtml = ensureClientHtmlSeoTags(autoHtml, client, url, isPathDemo, targetSlug);
              html = injectClaimBarIntoHtml(seoHtml, client);
            } else {
              html = buildBrandedPreviewHtml(client, { bypass: Boolean(bypass) });
            }
          }
          return new Response(html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0'
            }
          });
        }
      }

      // If this is a subdomain demo, NEVER allow unhandled assets to fall through to env.ASSETS (which triggers Cloudflare 403 Forbidden)
      if (isSubdomainDemo) {
        if (reqPath === '/index.html' || reqPath === '/') {
          return new Response(buildExpiredDemoHtml({ businessName: targetSlug }), {
            status: 403,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
              'X-Robots-Tag': 'noindex, nofollow'
            }
          });
        }
        return new Response('Asset not found', {
          status: 404,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0'
          }
        });
      }
    }

    // 1-redirect. Permanent 301 Redirect deprecated /demo-success to modern Haute Couture /revision portal
    if (url.pathname === '/demo-success' || url.pathname === '/demo-success.html') {
      const cid = url.searchParams.get('cid') || '';
      const email = url.searchParams.get('email') || '';
      const sessionId = url.searchParams.get('session_id') || '';
      const target = `/revision?cid=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}&session_id=${encodeURIComponent(sessionId)}`;
      return Response.redirect(new URL(target, url.origin).toString(), 301);
    }

    // 1-admin. Clean Studio Command Center Route: /admin is served directly by Cloudflare Assets (Clean URLs) with no-store headers
    if (url.pathname === '/admin') {
      if (env.ASSETS) {
        const assetRes = await env.ASSETS.fetch(request);
        const newHeaders = new Headers(assetRes.headers);
        newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers: newHeaders
        });
      }
    }

    // 1a-track. Public Demo View Tracking Beacon (Alias for /api/track)
    if (url.pathname === '/api/track-view' && (request.method === 'POST' || request.method === 'GET')) {
      const forwardedUrl = new URL(request.url);
      forwardedUrl.pathname = '/api/track';
      return await this.fetch(new Request(forwardedUrl.toString(), request), env, ctx);
    }

    // 1aa. Google Places Photo Media Proxy (GET /api/places-photo?ref=places/.../photos/...&maxWidth=800)
    if (url.pathname === '/api/places-photo' && request.method === 'GET') {
      const photoRef = (url.searchParams.get('ref') || '').trim();
      const maxWidth = parseInt(url.searchParams.get('maxWidth') || '800', 10);
      const maxHeight = parseInt(url.searchParams.get('maxHeight') || '800', 10);
      const effectivePlacesKey = (cfg.googlePlacesApiKey || '').trim();
      if (!photoRef || !effectivePlacesKey) {
        return new Response('Missing photo reference or API key', { status: 400 });
      }
      try {
        const cleanRef = photoRef.replace(/^\/+/, '');
        const gUrl = `https://places.googleapis.com/v1/${cleanRef}/media?maxWidthPx=${maxWidth}&maxHeightPx=${maxHeight}&key=${effectivePlacesKey}`;
        const pRes = await fetch(gUrl, { redirect: 'follow' });
        if (!pRes.ok) {
          return new Response('Failed to load photo', { status: pRes.status });
        }
        const contentType = pRes.headers.get('content-type') || 'image/jpeg';
        return new Response(pRes.body, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=604800, immutable',
            'Access-Control-Allow-Origin': '*'
          }
        });
      } catch (err) {
        return new Response(err.message, { status: 500 });
      }
    }

    // 1b. Public Client Preview Info (GET /api/client-public?cid=cus_...)
    if (url.pathname === '/api/client-public' && request.method === 'GET') {
      const cid = (url.searchParams.get('cid') || '').trim();
      if (!cid || !cfg.stripeSecretKey) {
        return new Response(JSON.stringify({ ok: false }), { status: 400, headers: corsHeaders });
      }
      const res = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cid)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
      });
      if (!res.ok) {
        return new Response(JSON.stringify({ ok: false }), { status: 404, headers: corsHeaders });
      }
      const cust = await res.json();
      const rec = formatCustomerRecord(cust);
      return new Response(
        JSON.stringify({
          ok: true,
          id: rec.id,
          name: rec.name,
          businessName: rec.businessName,
          email: rec.email,
          demoUrl: rec.demoUrl
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 1c. Outbound Demo 1-Click Claim -> Pre-configured Stripe Checkout -> Redirects to /demo-success
    if (url.pathname === '/api/claim' && (request.method === 'GET' || request.method === 'POST')) {
      try {
        if (!cfg.stripeSecretKey) {
          return new Response(JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' }), { status: 500, headers: corsHeaders });
        }
        let cid = (url.searchParams.get('cid') || '').trim();
        let email = (url.searchParams.get('email') || '').trim();
        let bizName = (url.searchParams.get('name') || '').trim();
        let demoUrl = (url.searchParams.get('demo') || '').trim();
        const wantJson = url.searchParams.get('format') === 'json';

        let cust = null;
        if (cid && cid.startsWith('cus_')) {
          const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cid)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          });
          if (cRes.ok) {
            cust = await cRes.json();
          } else {
            cust = await ensureStripeCustomerMigrated(env, cid, cfg.stripeSecretKey);
            if (cust && cust.id) cid = cust.id;
          }
          if (cust) {
            if (!email) email = cust.email || (cust.metadata && cust.metadata.customer_email) || '';
            if (!bizName) bizName = (cust.metadata && cust.metadata.business_name) || cust.name || '';
            if (!demoUrl) demoUrl = (cust.metadata && cust.metadata.demo_url) || '';
          }
        } else if (email) {
          cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
          if (cust) cid = cust.id;
        }
        if (!cust && (demoUrl || bizName)) {
          const fallbackSlug = slugifyName(extractCleanHost(demoUrl).replace(/\.wynnpages\.com\.au$/i, '') || bizName);
          if (fallbackSlug) {
            cust = await ensureStripeCustomerMigrated(env, fallbackSlug, cfg.stripeSecretKey);
            if (cust && cust.id) {
              cid = cust.id;
              if (!email) email = cust.email || (cust.metadata && cust.metadata.customer_email) || '';
              if (!bizName) bizName = (cust.metadata && cust.metadata.business_name) || cust.name || '';
            }
          }
        }

        const origin = url.origin;
        const successUrl = `${origin}/revision?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&client_id=${encodeURIComponent(cid)}&cid=${encodeURIComponent(cid)}`;
        const cancelUrl = demoUrl && demoUrl.startsWith('http') ? demoUrl : `${origin}/?canceled=true`;

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        if (cust && cust.id) {
          params.append('customer', cust.id);
        } else if (email) {
          params.append('customer_email', email);
        }
        if (cid) params.append('client_reference_id', cid);
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('allow_promotion_codes', 'true');
        params.append('billing_address_collection', 'auto');
        params.append('phone_number_collection[enabled]', 'true');
        params.append('invoice_creation[enabled]', 'true');
        params.append('metadata[flow_type]', 'outbound');
        const outboundSlugMeta = slugifyName((cust && cust.metadata && cust.metadata.demo_slug) || bizName || '');
        if (outboundSlugMeta) params.append('metadata[demo_slug]', outboundSlugMeta);

        let isFlashDeal50 = (url.searchParams.get('deal') === 'flash50');
        if (cust && cust.metadata && cust.metadata.deal_status === 'flash_deal') {
          const expMs = new Date(cust.metadata.deal_expires_at).getTime();
          if (expMs > Date.now()) {
            isFlashDeal50 = true;
          }
        }

        if (isFlashDeal50) {
          params.append('line_items[0][price_data][currency]', 'aud');
          params.append('line_items[0][price_data][unit_amount]', '29900');
          params.append('line_items[0][price_data][product_data][name]', bizName ? `WynnPages — Atelier Sponsorship Deal (50% OFF) for ${bizName}` : 'WynnPages — Claim Website (50% OFF Sponsorship)');
          params.append('line_items[0][price_data][product_data][description]', 'Exclusive 72h Atelier Sponsorship • 100% Full Ownership • Zero Monthly Retainers • $299 AUD Flat (Save $300 AUD)');
          params.append('line_items[0][quantity]', '1');
          params.append('metadata[deal_type]', 'flash_deal_50');
        } else if (env.STRIPE_PRICE_ID) {
          params.append('line_items[0][price]', env.STRIPE_PRICE_ID);
          params.append('line_items[0][quantity]', '1');
        } else {
          params.append('line_items[0][price_data][currency]', 'aud');
          params.append('line_items[0][price_data][unit_amount]', '59900');
          params.append('line_items[0][price_data][product_data][name]', bizName ? `WynnPages — Bespoke Website for ${bizName}` : 'WynnPages — Claim Your Custom Artisan Website');
          params.append('line_items[0][price_data][product_data][description]', 'Full Ownership • Custom Demo Ready • Zero Monthly Retainers • Flat $599 AUD');
          params.append('line_items[0][quantity]', '1');
        }

        params.append('metadata[studio]', 'WynnPages Australia');
        params.append('metadata[flow]', 'outbound_demo');
        if (cid) params.append('metadata[customer_id]', cid);
        if (bizName) params.append('metadata[customer_name]', bizName);
        if (email) params.append('metadata[customer_email]', email);
        if (demoUrl) params.append('metadata[demo_url]', demoUrl);

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        const session = await stripeRes.json();
        if (!stripeRes.ok || !session.url) {
          const msg = session.error ? session.error.message : 'Could not create Stripe Checkout session';
          return new Response(JSON.stringify({ error: msg }), { status: 400, headers: corsHeaders });
        }

        if (wantJson) {
          return new Response(JSON.stringify({ ok: true, sessionId: session.id, url: session.url }), { status: 200, headers: corsHeaders });
        }
        return Response.redirect(session.url, 303);
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 2. Stripe Checkout Session Endpoint
    if (url.pathname === '/api/create-checkout-session' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const email = (body.email || '').trim();
        const name = (body.name || '').trim();
        const phone = (body.phone || '').trim();

        if (!email) {
          return new Response(JSON.stringify({ error: 'Email address is required.' }), {
            status: 400,
            headers: corsHeaders
          });
        }

        if (!cfg.stripeSecretKey) {
          return new Response(
            JSON.stringify({ error: 'STRIPE_SECRET_KEY is not configured.' }),
            { status: 500, headers: corsHeaders }
          );
        }

        // Pre-create or update Stripe Customer so we always have their Name + Mobile Phone saved!
        const existingCust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
        const custParams = new URLSearchParams();
        custParams.append('email', email);
        if (name) custParams.append('name', name);
        if (phone) custParams.append('phone', phone);
        custParams.append('metadata[studio]', 'WynnPages Australia');
        if (name) custParams.append('metadata[customer_name]', name);
        if (phone) custParams.append('metadata[customer_phone]', phone);
        custParams.append('metadata[customer_email]', email);
        if (!existingCust || !existingCust.metadata || !existingCust.metadata.stage) {
          custParams.append('metadata[stage]', 'checkout_started');
        }

        const custUrl = existingCust
          ? `https://api.stripe.com/v1/customers/${encodeURIComponent(existingCust.id)}`
          : 'https://api.stripe.com/v1/customers';
        const custRes = await fetch(custUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: custParams.toString()
        });
        const savedCustomer = await custRes.json().catch(() => ({}));

        const origin = url.origin;
        const baseBriefUrl = env.TALLY_BRIEF_URL || `${origin}/onboarding?type=organic`;
        const separator = baseBriefUrl.includes('?') ? '&' : '?';
        const inboundCid = (savedCustomer && savedCustomer.id) ? savedCustomer.id : '';
        const successUrl = `${baseBriefUrl}${separator}session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}${inboundCid ? `&client_id=${encodeURIComponent(inboundCid)}` : ''}`;
        const cancelUrl = `${origin}/?canceled=true`;

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        if (savedCustomer && savedCustomer.id) {
          params.append('customer', savedCustomer.id);
          params.append('client_reference_id', savedCustomer.id);
        } else {
          params.append('customer_email', email);
        }
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('allow_promotion_codes', 'true');
        params.append('billing_address_collection', 'auto');
        params.append('phone_number_collection[enabled]', 'true');
        params.append('invoice_creation[enabled]', 'true');
        params.append('metadata[flow_type]', 'inbound');
        if (inboundCid) params.append('metadata[customer_id]', inboundCid);
        const inboundSlugMeta = slugifyName(name || email.split('@')[0] || '');
        if (inboundSlugMeta) params.append('metadata[demo_slug]', inboundSlugMeta);

        if (env.STRIPE_PRICE_ID) {
          params.append('line_items[0][price]', env.STRIPE_PRICE_ID);
          params.append('line_items[0][quantity]', '1');
        } else {
          params.append('line_items[0][price_data][currency]', 'aud');
          params.append('line_items[0][price_data][unit_amount]', '59900');
          params.append('line_items[0][price_data][product_data][name]', 'WynnPages — Complete Studio Build Slot');
          params.append('line_items[0][price_data][product_data][description]', 'Delivered in 1 week • Flat $599 AUD • Handcrafted Bespoke Web Atelier');
          params.append('line_items[0][quantity]', '1');
        }

        if (name) params.append('metadata[customer_name]', name);
        if (phone) params.append('metadata[customer_phone]', phone);
        if (email) params.append('metadata[customer_email]', email);
        params.append('metadata[studio]', 'WynnPages Australia');

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });

        const session = await stripeRes.json();

        if (!stripeRes.ok) {
          const errMsg = session.error ? session.error.message : 'Stripe API returned an error';
          return new Response(JSON.stringify({ error: errMsg }), {
            status: stripeRes.status,
            headers: corsHeaders
          });
        }

        return new Response(
          JSON.stringify({
            sessionId: session.id,
            url: session.url
          }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || 'An unexpected error occurred.' }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // 3. Post-Payment Session Verification & Automated Tax Invoice / Email / SMS / Telegram Trigger
    if ((url.pathname === '/api/verify-session' || url.pathname === '/api/verify-payment') && (request.method === 'POST' || request.method === 'GET')) {
      try {
        let sessionId = (url.searchParams.get('session_id') || url.searchParams.get('sessionId') || '').trim();
        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          if (!sessionId) sessionId = (body.sessionId || body.session_id || '').trim();
        }
        if (!sessionId || !sessionId.startsWith('cs_') || !cfg.stripeSecretKey) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing or invalid sessionId' }), { status: 200, headers: corsHeaders });
        }

        const result = await finalizeStripePaymentAndNotify({
          sessionId,
          origin: url.origin,
          env,
          ctx,
          cfg
        });

        return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 200, headers: corsHeaders });
      }
    }

    // 4. Atelier Onboarding Brief Submission Endpoint (Stage 2 Trigger)
    if (url.pathname === '/api/submit-brief' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        if (!cfg.stripeSecretKey) {
          return new Response(
            JSON.stringify({ error: 'Server configuration error: missing Stripe key.' }),
            { status: 500, headers: corsHeaders }
          );
        }

        const sessionId = (body.sessionId || '').trim();
        let email = (body.email || '').trim();
        let customerName = (body.name || '').trim();
        let customerPhone = (body.phone || '').trim();
        let paymentIntentId = '';
        let existingCustomerId = (body.customerId || '').trim();

        const briefType = (body.briefType || 'organic').trim();
        const businessName = (body.businessName || '').trim();
        const industry = (body.industry || '').trim();
        const displayPhone = (body.displayPhone || '').trim();
        const businessAddress = (body.businessAddress || '').trim();
        const socialLinks = (body.socialLinks || '').trim();
        const brandColors = (body.brandColors || '').trim();
        const vibeLinks = (body.vibeLinks || '').trim();
        const hasDomain = (body.hasDomain || '').trim();
        const existingDomain = (body.existingDomain || '').trim();
        const desiredDomains = (body.desiredDomains || '').trim();
        const domainAccessNotes = (body.domainAccessNotes || '').trim();
        const logoLink = (body.logoLink || '').trim();
        const menuLink = (body.menuLink || '').trim();
        const hasPhotos = (body.hasPhotos || '').trim();
        const photosLink = (body.photosLink || '').trim();

        if (!customerName && businessName) customerName = businessName;
        if (!customerPhone && displayPhone) customerPhone = displayPhone;

        // Optional file uploads to Stripe Files API + Google Drive Webhook
        let logoFileId = null;
        let menuFileId = null;
        let photosFileId = null;
        let logoDriveUrl = '';
        let menuDriveUrl = '';
        let photosDriveUrl = '';
        let driveFolderUrl = '';
        const driveFolderName = businessName || customerName || email || 'WynnPages Client';

        if (body.logoFile && body.logoFile.dataUrl) {
          logoFileId = await uploadStripeFile(body.logoFile, cfg.stripeSecretKey);
          const dRes = await uploadGoogleDriveFile(body.logoFile, driveFolderName, cfg.googleDriveWebhookUrl);
          if (dRes) {
            logoDriveUrl = dRes.fileUrl || '';
            if (dRes.folderUrl) driveFolderUrl = dRes.folderUrl;
          }
        }
        if (body.menuFile && body.menuFile.dataUrl) {
          menuFileId = await uploadStripeFile(body.menuFile, cfg.stripeSecretKey);
          const dRes = await uploadGoogleDriveFile(body.menuFile, driveFolderName, cfg.googleDriveWebhookUrl);
          if (dRes) {
            menuDriveUrl = dRes.fileUrl || '';
            if (dRes.folderUrl) driveFolderUrl = dRes.folderUrl;
          }
        }
        if (body.photosFile && body.photosFile.dataUrl) {
          photosFileId = await uploadStripeFile(body.photosFile, cfg.stripeSecretKey);
          const dRes = await uploadGoogleDriveFile(body.photosFile, driveFolderName, cfg.googleDriveWebhookUrl);
          if (dRes) {
            photosDriveUrl = dRes.fileUrl || '';
            if (dRes.folderUrl) driveFolderUrl = dRes.folderUrl;
          }
        }

        // Inspect Checkout Session if session_id is present
        if (sessionId && sessionId.startsWith('cs_')) {
          const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          });
          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            if (!email && sessionData.customer_details && sessionData.customer_details.email) {
              email = sessionData.customer_details.email;
            }
            if (!email && sessionData.customer_email) {
              email = sessionData.customer_email;
            }
            if (sessionData.metadata) {
              if (!customerName) customerName = sessionData.metadata.customer_name || '';
              if (!customerPhone) customerPhone = sessionData.metadata.customer_phone || '';
            }
            if (!customerName && sessionData.customer_details && sessionData.customer_details.name) {
              customerName = sessionData.customer_details.name;
            }
            if (typeof sessionData.payment_intent === 'string') {
              paymentIntentId = sessionData.payment_intent;
            }
            if (typeof sessionData.customer === 'string') {
              existingCustomerId = sessionData.customer;
            }
          }
        }

        // Look up existing customer by customerId or email if not linked via session
        let existingCustObj = null;
        if (existingCustomerId && existingCustomerId.startsWith('cus_')) {
          const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(existingCustomerId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          });
          if (cRes.ok) existingCustObj = await cRes.json();
        }
        if (!existingCustObj && email) {
          const found = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
          if (found) {
            existingCustObj = found;
            existingCustomerId = found.id;
          }
        }
        if (existingCustObj) {
          if (!customerName) customerName = existingCustObj.name || (existingCustObj.metadata && existingCustObj.metadata.customer_name) || '';
          if (!customerPhone) customerPhone = existingCustObj.phone || (existingCustObj.metadata && existingCustObj.metadata.customer_phone) || '';
        }

        const existingStage = (existingCustObj && existingCustObj.metadata && existingCustObj.metadata.stage) || '';
        const existingFlow = (existingCustObj && existingCustObj.metadata && existingCustObj.metadata.flow_type) || '';
        const keepOutboundStage = (briefType === 'demo' || existingFlow === 'outbound') && existingStage.startsWith('outbound_');

        const isExistingDom = hasDomain === 'I already own a domain' || hasDomain === 'Yes, I have one';
        const rawDomainSummary = isExistingDom ? existingDomain : desiredDomains;
        const candidateHost = extractCleanHost(rawDomainSummary);

        let autoLiveUrl = (existingCustObj && existingCustObj.metadata && existingCustObj.metadata.live_url) || '';
        if (
          !autoLiveUrl &&
          candidateHost &&
          candidateHost.includes('.') &&
          !candidateHost.endsWith('wynnpages.com.au') &&
          !candidateHost.endsWith('pages.dev') &&
          !candidateHost.endsWith('workers.dev')
        ) {
          autoLiveUrl = candidateHost;
        }

        const cleanExistingDomain = isExistingDom && candidateHost && !candidateHost.endsWith('wynnpages.com.au') && !candidateHost.endsWith('pages.dev')
          ? candidateHost
          : (existingDomain || '').slice(0, 490);
        const cleanDesiredDomains = !isExistingDom && candidateHost && !candidateHost.endsWith('wynnpages.com.au') && !candidateHost.endsWith('pages.dev')
          ? candidateHost
          : (desiredDomains || '').slice(0, 490);
        const domainSummary = isExistingDom ? cleanExistingDomain : cleanDesiredDomains;

        const dnsMode = (body.dnsMode || '').trim();
        const domainDelegated = Boolean(body.domainDelegated);
        const nowIso = new Date().toISOString();

        const metadataEntries = {
          studio: 'WynnPages Australia',
          stage: keepOutboundStage ? existingStage : 'brief_completed',
          brief_status: 'completed',
          brief_type: briefType,
          submitted_at: nowIso,
          customer_email: email.slice(0, 490),
          customer_name: customerName.slice(0, 490),
          customer_phone: customerPhone.slice(0, 490),
          business_name: businessName.slice(0, 490),
          display_phone: displayPhone.slice(0, 490),
          business_address: businessAddress.slice(0, 490),
          social_links: socialLinks.slice(0, 490),
          industry: industry.slice(0, 490),
          brand_colors: brandColors.slice(0, 490),
          vibe_links: vibeLinks.slice(0, 490),
          has_domain: hasDomain.slice(0, 490),
          dns_mode: dnsMode.slice(0, 120),
          existing_domain: cleanExistingDomain,
          desired_domains: cleanDesiredDomains,
          domain_access_notes: domainAccessNotes.slice(0, 490),
          logo_file_id: logoFileId || '',
          logo_file_name: (body.logoFile && body.logoFile.name ? body.logoFile.name : logoLink).slice(0, 490),
          logo_drive_url: logoDriveUrl.slice(0, 490),
          menu_file_id: menuFileId || '',
          menu_file_name: (body.menuFile && body.menuFile.name ? body.menuFile.name : menuLink).slice(0, 490),
          menu_drive_url: menuDriveUrl.slice(0, 490),
          has_photos: hasPhotos.slice(0, 490),
          photos_file_id: photosFileId || '',
          photos_file_name: (body.photosFile && body.photosFile.name ? body.photosFile.name : photosLink).slice(0, 490),
          photos_drive_url: photosDriveUrl.slice(0, 490),
          drive_folder_url: driveFolderUrl.slice(0, 490)
        };
        if (domainDelegated) {
          metadataEntries.domain_delegated = 'true';
          metadataEntries.domain_delegated_at = nowIso;
        }
        if (autoLiveUrl) {
          metadataEntries.live_url = autoLiveUrl;
        }

        const summaryDesc = `WynnPages Brief [${briefType.toUpperCase()}] • ${industry || 'Custom Demo'} • Domain: ${domainSummary || 'TBD'}`;

        // Update PaymentIntent if available
        if (paymentIntentId) {
          const piParams = new URLSearchParams();
          piParams.append('description', summaryDesc.slice(0, 350));
          for (const [k, v] of Object.entries(metadataEntries)) {
            if (v) piParams.append(`metadata[${k}]`, v);
          }
          await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: piParams.toString()
          });
        }

        // Create or Update Stripe Customer record
        const custParams = new URLSearchParams();
        if (email) custParams.append('email', email);
        if (customerName) custParams.append('name', customerName);
        if (customerPhone) custParams.append('phone', customerPhone);
        custParams.append('description', summaryDesc.slice(0, 350));
        for (const [k, v] of Object.entries(metadataEntries)) {
          if (v) custParams.append(`metadata[${k}]`, v);
        }
        if (sessionId) custParams.append('metadata[checkout_session_id]', sessionId);

        const custEndpoint = existingCustomerId
          ? `https://api.stripe.com/v1/customers/${encodeURIComponent(existingCustomerId)}`
          : 'https://api.stripe.com/v1/customers';

        const custRes = await fetch(custEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: custParams.toString()
        });

        const custData = await custRes.json().catch(() => ({}));

        // Only auto-provision a network Zone during brief submit if domain already exists (or client already registered & delegated it)
        let bindRes = null;
        if (autoLiveUrl && (isExistingDom || domainDelegated) && env && env.WYNN_KV) {
          bindRes = await ensureCustomLiveDomainOnCloudflare(autoLiveUrl, env, cfg.cfApiToken);
          if (bindRes && bindRes.nameservers && custData && custData.id) {
            const nsP = new URLSearchParams();
            nsP.append('metadata[cf_nameservers]', bindRes.nameservers.slice(0, 490));
            if (bindRes.zoneStatus) {
              nsP.append('metadata[cf_zone_status]', String(bindRes.zoneStatus));
            }
            await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(custData.id)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: nsP.toString()
            }).catch(() => { });
          }
        }

        // Notify studio admin immediately if client already provided registrar access / delegation inside /demo-success
        if (domainDelegated && cfg.resendApiKey) {
          const customerLabel = businessName || customerName || 'Client';
          const domainLabel = autoLiveUrl || domainSummary || 'TBD';
          const adminHtml = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fcf9f3;border:1px solid #e5dec9;border-radius:18px;">
              <h2 style="color:#96432b;margin-top:0;font-size:20px;">🎉 Client Submitted Brief + Domain Access!</h2>
              <p style="font-size:14px;color:#2b251e;line-height:1.5;"><strong>${customerLabel}</strong> completed confirmation and provided domain access right away.</p>
              <div style="background:#fff;border:1px solid #d5cebf;border-radius:12px;padding:14px;margin:16px 0;font-size:13px;line-height:1.6;">
                <div><strong>Business:</strong> ${customerLabel}</div>
                <div><strong>Domain:</strong> <code style="font-weight:bold;color:#96432b;">${domainLabel}</code></div>
                <div><strong>Email:</strong> ${email || 'N/A'}</div>
                ${domainAccessNotes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;"><strong>Access / Notes:</strong><br><pre style="font-family:monospace;background:#f8f9fa;padding:8px;border-radius:6px;margin-top:4px;white-space:pre-wrap;">${domainAccessNotes}</pre></div>` : ''}
              </div>
              <p style="margin-top:20px;"><a href="https://wynnpages.com.au/admin" style="display:inline-block;background:#96432b;color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 22px;border-radius:12px;">Open WynnPages Admin →</a></p>
            </div>`;
          runInBg(ctx, sendResendEmail({
            to: 'hello@wynnpages.com.au',
            subject: `⚡ [DOMAIN READY] ${customerLabel} (${domainLabel}) submitted access!`,
            html: adminHtml,
            cfg
          }));
        }

        // Trigger Stage 2 SMS + Email to Client & Record Realtime Telegram Alert
        const resolvedNsStr = (bindRes && bindRes.attached && bindRes.nameservers) ? bindRes.nameservers : '';
        const clientRecord = {
          id: (custData && custData.id) || existingCustomerId || '',
          name: customerName,
          businessName,
          email,
          phone: customerPhone,
          demoSlug: slugifyName(businessName || customerName || ''),
          briefType,
          industry,
          brandColors,
          vibeLinks,
          existingDomain: cleanExistingDomain,
          desiredDomains: cleanDesiredDomains,
          liveUrl: autoLiveUrl || '',
          stage: 'brief_completed',
          paymentStatus: 'paid',
          dnsMode,
          domainDelegated,
          domainAccessNotes,
          cfNameservers: resolvedNsStr
        };

        await upsertD1Client(env, clientRecord);
        await syncClientsKvSnapshot(env);
        const dbClearDraft = getD1(env);
        if (dbClearDraft) {
          const draftKeysToClear = [];
          if (clientRecord.id) draftKeysToClear.push(`onboarding_draft:cid:${clientRecord.id}`);
          if (email) draftKeysToClear.push(`onboarding_draft:email:${email.toLowerCase()}`);
          if (sessionId) draftKeysToClear.push(`onboarding_draft:sid:${sessionId}`);
          if (draftKeysToClear.length) {
            await dbClearDraft.batch(draftKeysToClear.map((k) => dbClearDraft.prepare('DELETE FROM settings WHERE key = ?').bind(k))).catch(() => {});
          }
        }
        const briefLabel = businessName || customerName || email || 'Khách hàng mới';
        await recordActivityAndNotify({
          type: 'brief_completed',
          title: '📝 Khách Đã Gửi Onboarding Brief!',
          message: `${briefLabel} vừa hoàn tất 4 bước Onboarding Brief${domainSummary ? ` (Tên miền: ${domainSummary})` : ''}.`,
          clientName: briefLabel,
          slug: clientRecord.demoSlug || '',
          env,
          ctx
        });

        const notification = await triggerLifecycleNotification({
          stage: 'brief_completed',
          client: clientRecord,
          origin: url.origin,
          cfg,
          env,
          ctx,
          waitForTelegram: true
        });

        const nsList = resolvedNsStr ? resolvedNsStr.split(',').map((s) => s.trim()).filter(Boolean) : [];
        return new Response(
          JSON.stringify({
            ok: true,
            customerId: custData.id || existingCustomerId || null,
            paymentIntentId: paymentIntentId || null,
            logoFileId,
            menuFileId,
            nameservers: nsList,
            zoneStatus: (bindRes && bindRes.zoneStatus) || null,
            notification
          }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message || 'Could not save brief.' }),
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // 4b. Client Domain Delegation Confirmation (POST /api/domain-delegated)
    if (url.pathname === '/api/domain-delegated' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const cid = (body.customerId || body.cid || '').trim();
        const email = (body.email || '').trim().toLowerCase();
        const rawDomain = (body.domain || '').trim();
        const bizName = (body.businessName || body.name || '').trim();
        const accessNotes = (body.accessNotes || body.notes || '').trim();
        const provider = (body.provider || 'VentraIP Australia').trim();
        const cleanHost = extractCleanHost(rawDomain);

        let cust = null;
        if (cid && cfg.stripeSecretKey) {
          const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cid)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          });
          if (cRes.ok) cust = await cRes.json();
        }
        if (!cust && email && cfg.stripeSecretKey) {
          cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
        }

        const nowIso = new Date().toISOString();
        let bindResult = null;
        if (cleanHost && cleanHost.includes('.') && !cleanHost.endsWith('wynnpages.com.au') && env && env.WYNN_KV) {
          bindResult = await ensureCustomLiveDomainOnCloudflare(cleanHost, env, cfg.cfApiToken);
        }

        if (cust && cust.id && cfg.stripeSecretKey) {
          const uParams = new URLSearchParams();
          uParams.append('metadata[domain_delegated]', 'true');
          uParams.append('metadata[domain_delegated_at]', nowIso);
          uParams.append('metadata[domain_provider]', provider.slice(0, 490));
          if (cleanHost && !cleanHost.endsWith('wynnpages.com.au')) {
            uParams.append('metadata[live_url]', cleanHost.slice(0, 490));
          }
          if (accessNotes) {
            uParams.append('metadata[domain_access_notes]', accessNotes.slice(0, 490));
          }
          if (bindResult && bindResult.nameservers) {
            uParams.append('metadata[cf_nameservers]', bindResult.nameservers.slice(0, 490));
          }
          const patchCustRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          }).catch(() => null);
          if (patchCustRes && patchCustRes.ok) {
            await upsertD1Client(env, formatCustomerRecord(await patchCustRes.json()));
          }
        }

        // Notify studio admin via Resend
        const customerLabel = bizName || (cust && (cust.metadata && cust.metadata.business_name || cust.name)) || 'A client';
        const domainLabel = cleanHost || (cust && cust.metadata && cust.metadata.live_url) || rawDomain || 'TBD';

        await recordActivityAndNotify({
          type: 'domain_updated',
          title: '🌐 Tên Miền Đã Cập Nhật!',
          message: `${customerLabel} đã cập nhật thông tin tên miền ${domainLabel}. Sẵn sàng trỏ DNS!`,
          clientName: customerLabel,
          slug: domainLabel,
          env,
          ctx
        });

        if (cfg.resendApiKey) {
          const emailHtml = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fcf9f3;border:1px solid #e5dec9;border-radius:18px;">
              <h2 style="color:#96432b;margin-top:0;font-size:20px;">🎉 Client Completed Domain Setup!</h2>
              <p style="font-size:14px;color:#2b251e;line-height:1.5;"><strong>${customerLabel}</strong> has confirmed domain setup on <strong>${provider}</strong>.</p>
              <div style="background:#fff;border:1px solid #d5cebf;border-radius:12px;padding:14px;margin:16px 0;font-size:13px;line-height:1.6;">
                <div><strong>Business:</strong> ${customerLabel}</div>
                <div><strong>Domain:</strong> <code style="font-weight:bold;color:#96432b;">${domainLabel}</code></div>
                <div><strong>Provider:</strong> ${provider}</div>
                <div><strong>Email:</strong> ${email || (cust && cust.email) || 'N/A'}</div>
                ${accessNotes ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #ddd;"><strong>Login / Notes:</strong><br><pre style="font-family:monospace;background:#f8f9fa;padding:8px;border-radius:6px;margin-top:4px;white-space:pre-wrap;">${accessNotes}</pre></div>` : ''}
              </div>
              <p style="margin-top:20px;"><a href="https://wynnpages.com.au/admin" style="display:inline-block;background:#96432b;color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 22px;border-radius:12px;">Open WynnPages Admin to Launch →</a></p>
            </div>
          `;
          await sendResendEmail({
            to: 'hello@wynnpages.com.au',
            subject: `⚡ [DOMAIN READY] ${customerLabel} (${domainLabel}) completed setup!`,
            html: emailHtml,
            cfg
          }).catch(() => { });
        }

        return new Response(JSON.stringify({
          ok: true,
          delegatedAt: nowIso,
          cleanHost,
          nameservers: bindResult ? bindResult.nameservers : null
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4b-activity. Activity Feed & Real-Time Push Notification Engine (D1 + KV Synced)
    if (url.pathname === '/api/activity-feed' && request.method === 'GET') {
      const auth = verifyAdminAuth(request, env, cfg);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: buildAdminHeaders(corsHeaders) });
      }
      const db = getD1(env);
      let events = [];
      if (db) {
        await ensureD1Schema(env);
        const rowsRes = await db.prepare('SELECT id, type, icon, title, message, client_name, slug, timestamp FROM activity_events ORDER BY timestamp DESC LIMIT 20').all().catch(() => null);
        if (rowsRes && Array.isArray(rowsRes.results)) {
          events = rowsRes.results.map((r) => ({
            id: r.id,
            type: r.type,
            icon: r.icon,
            title: r.title,
            message: r.message,
            clientName: r.client_name,
            slug: r.slug,
            timestamp: r.timestamp
          }));
        }
      } else if (env && env.WYNN_KV) {
        events = ((await env.WYNN_KV.get('activity_events', 'json').catch(() => null)) || []).slice(0, 20);
      }
      return new Response(JSON.stringify({ ok: true, events }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
    }

    if (url.pathname === '/api/activity-feed/clear' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const auth = verifyAdminAuth(request, env, cfg, body);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: buildAdminHeaders(corsHeaders) });
      }
      const db = getD1(env);
      if (db) {
        await ensureD1Schema(env);
        await db.prepare('DELETE FROM activity_events').run().catch(() => {});
      } else if (env && env.WYNN_KV) {
        await env.WYNN_KV.put('activity_events', JSON.stringify([])).catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
    }

    if (url.pathname === '/api/telegram-config' && request.method === 'GET') {
      const auth = verifyAdminAuth(request, env, cfg);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: buildAdminHeaders(corsHeaders) });
      }
      const rt = await loadSyncedRuntime(env);
      return new Response(JSON.stringify({
        ok: true,
        botToken: rt.cfg.telegramBotToken || '',
        chatId: rt.cfg.telegramChatId || '',
        hasBot: Boolean(rt.cfg.telegramBotToken)
      }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
    }

    if (url.pathname === '/api/telegram-config' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const auth = verifyAdminAuth(request, env, cfg, body);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: buildAdminHeaders(corsHeaders) });
      }
      const botToken = (body.botToken || '').trim();
      const chatId = (body.chatId || '').trim();
      await saveSyncedSettings(env, { telegramBotToken: botToken, telegramChatId: chatId }, { clearEmpty: true });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
    }

    if (url.pathname === '/api/test-notify' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const auth = verifyAdminAuth(request, env, cfg, body);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: buildAdminHeaders(corsHeaders) });
      }
      const customMsg = (body.message || '').trim() || 'Đây là thông báo thử nghiệm từ WynnPages Studio PWA đến iPhone của bạn!';
      await recordActivityAndNotify({
        type: 'payment_received',
        title: '🔔 Thử Nghiệm Thông Báo PWA iOS',
        message: customMsg,
        clientName: 'WynnPages Studio Test',
        slug: 'test',
        env,
        ctx
      });
      return new Response(JSON.stringify({ ok: true, message: 'Đã phát tín hiệu thông báo thử nghiệm!' }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
    }

    // 4c. Upload Demo Bundle to Cloudflare KV Native Hosting (POST /api/upload-demo-bundle)
    if (url.pathname === '/api/upload-demo-bundle' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }

        if (!env || !env.WYNN_KV) {
          return new Response(JSON.stringify({ error: 'Cloudflare KV (WYNN_KV) is not bound or available!' }), { status: 500, headers: corsHeaders });
        }

        const customerId = (body.customerId || '').trim();
        const rawSlug = (body.slug || '').trim();
        const files = Array.isArray(body.files) ? body.files : [];

        if (!files.length) {
          return new Response(JSON.stringify({ error: 'Không có file nào trong gói tải lên!' }), { status: 400, headers: corsHeaders });
        }

        let cust = null;
        let effectiveCfg = getConfig(env, body.credentials || {});
        if (customerId && effectiveCfg.stripeSecretKey) {
          const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (cRes.ok) cust = await cRes.json();
        }

        const formatted = cust ? formatCustomerRecord(cust) : null;
        const targetSlug = slugifyName(rawSlug || (formatted && (formatted.demoSlug || formatted.businessName || formatted.name)) || 'demo');
        if (!targetSlug) {
          return new Response(JSON.stringify({ error: 'Slug không hợp lệ!' }), { status: 400, headers: corsHeaders });
        }

        const nowIso = new Date().toISOString();

        // 1. Check previous manifest to clean up obsolete deleted files (preserving uploaded client logos & media unless purged)
        const isPartial = body.partialUpdate === true;
        const metaKey = `site_meta:${targetSlug}`;
        const prevMeta = await env.WYNN_KV.get(metaKey, 'json').catch(() => null);
        const isPreservedAsset = (p) => body.purgeCustomAssets !== true && /^\/assets\/(lux-logo\.svg|logo\.svg|client-logo\.|client-photo-|menu-revision)/i.test(p);

        const idxFile = files.find(f => f && (f.path === '/index.html' || f.path === 'index.html') && f.text);
        if (idxFile && idxFile.text && body.purgeCustomAssets !== true) {
          const prevHtml = await env.WYNN_KV.get(`site_asset:${targetSlug}:/index.html`, 'text').catch(() => null);
          const prevParsed = prevHtml ? parseConfigAndMenuFromHtml(prevHtml) : null;
          const prevCfg = prevParsed && prevParsed.config;
          const incomingParsed = parseConfigAndMenuFromHtml(idxFile.text);
          const incomingCfg = incomingParsed && incomingParsed.config;
          const preservedLogo = prevCfg ? String(prevCfg.wordmarkUrl || prevCfg.logoUrl || '').trim() : '';
          if (preservedLogo && incomingCfg && !String(incomingCfg.logoUrl || '').trim()) {
            const nextCfg = { ...incomingCfg, logoUrl: preservedLogo };
            idxFile.text = updateHtmlWithConfigAndMenu(idxFile.text, nextCfg, null);
          }
        }

        const newPathsSet = new Set(files.map(f => {
          let p = (f.path || '').trim();
          if (!p.startsWith('/')) p = '/' + p;
          return p;
        }));
        const preservedPaths = (prevMeta && Array.isArray(prevMeta.filesList))
          ? prevMeta.filesList.filter(p => isPreservedAsset(p) && !newPathsSet.has(p))
          : [];

        if (!isPartial && prevMeta && Array.isArray(prevMeta.filesList)) {
          const obsoleteDeletes = prevMeta.filesList
            .filter(oldPath => !newPathsSet.has(oldPath) && !isPreservedAsset(oldPath))
            .map(oldPath => env.WYNN_KV.delete(`site_asset:${targetSlug}:${oldPath}`).catch(() => { }));
          if (obsoleteDeletes.length) {
            if (ctx && typeof ctx.waitUntil === 'function') {
              ctx.waitUntil(Promise.all(obsoleteDeletes));
            } else {
              await Promise.all(obsoleteDeletes);
            }
          }
        }

        // 2. Put all files into KV concurrently
        await Promise.all(files.map(async (file) => {
          let normPath = (file.path || '').trim();
          if (!normPath.startsWith('/')) normPath = '/' + normPath;
          const assetKey = `site_asset:${targetSlug}:${normPath}`;
          const mimeType = file.type || getMimeType(normPath);

          if (file.base64) {
            const bytes = base64ToUint8Array(file.base64);
            await env.WYNN_KV.put(assetKey, bytes.buffer, {
              metadata: { mimeType, size: bytes.length, updatedAt: nowIso }
            });
          } else if (file.text !== undefined) {
            await env.WYNN_KV.put(assetKey, file.text, {
              metadata: { mimeType, size: file.text.length, updatedAt: nowIso }
            });
          }
        }));

        // 3. Save site metadata (extract palette & salonName from index.html if present)
        let detectedPalette = body.palette || '';
        let detectedBizName = body.businessName || '';
        if (idxFile && idxFile.text) {
          if (!detectedPalette) {
            const palMatch = idxFile.text.match(/data-palette=["'](0[1-5])["']/);
            if (palMatch) detectedPalette = palMatch[1];
          }
          if (!detectedBizName) {
            const nameMatch = idxFile.text.match(/salonName:\s*"([^"]+)"/);
            if (nameMatch) detectedBizName = nameMatch[1];
          }
        }
        const mergedFilesList = isPartial && prevMeta && Array.isArray(prevMeta.filesList)
          ? Array.from(new Set([...prevMeta.filesList, ...newPathsSet]))
          : Array.from(new Set([...preservedPaths, ...newPathsSet]));

        await env.WYNN_KV.put(metaKey, JSON.stringify({
          slug: targetSlug,
          customerId: customerId || (cust && cust.id) || '',
          businessName: detectedBizName || (prevMeta && prevMeta.businessName) || '',
          palette: detectedPalette || (prevMeta && prevMeta.palette) || '01',
          uploadedAt: nowIso,
          filesCount: mergedFilesList.length,
          filesList: mergedFilesList
        }));

        // 4. Update customer in Stripe if customerId exists (or auto-resolve by slug)
        const brandedDemoUrl = `https://${targetSlug}.wynnpages.com.au`;
        let resolvedCustomerId = customerId;
        if (!resolvedCustomerId && effectiveCfg.stripeSecretKey) {
          const matched = await findCustomerBySlugOrId(targetSlug, effectiveCfg.stripeSecretKey).catch(() => null);
          if (matched && matched.id) resolvedCustomerId = matched.id;
        }
        let updatedCustRecord = null;
        if (resolvedCustomerId && effectiveCfg.stripeSecretKey) {
          const uParams = new URLSearchParams();
          uParams.append('metadata[demo_source_type]', 'kv');
          uParams.append('metadata[demo_files_count]', String(mergedFilesList.length));
          uParams.append('metadata[demo_uploaded_at]', nowIso);
          uParams.append('metadata[demo_slug]', targetSlug);
          uParams.append('metadata[demo_url]', brandedDemoUrl);
          if (detectedPalette) {
            uParams.append('metadata[demo_palette]', detectedPalette);
          }

          const uRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(resolvedCustomerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          });
          if (uRes.ok) {
            const uData = await uRes.json();
            updatedCustRecord = formatCustomerRecord(uData);
          }
        }

        // 5. Ensure subdomain route in background
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(ensureCloudflareSubdomain(targetSlug, env).catch(() => { }));
        } else {
          await ensureCloudflareSubdomain(targetSlug, env).catch(() => { });
        }

        return new Response(JSON.stringify({
          ok: true,
          slug: targetSlug,
          demoUrl: brandedDemoUrl,
          filesCount: files.length,
          client: updatedCustRecord
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4d. Export Client Demo Bundle for Antigravity Local Editing (GET /api/demo-bundle?slug=xxx&key=...)
    if (url.pathname === '/api/demo-bundle' && request.method === 'GET') {
      try {
        const providedKey = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Unauthorized. Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
        }

        const rawSlugOrId = (url.searchParams.get('slug') || url.searchParams.get('cid') || '').trim();
        if (!rawSlugOrId) {
          return new Response(JSON.stringify({ error: 'Missing ?slug= or ?cid= parameter.' }), { status: 400, headers: corsHeaders });
        }

        const client = cfg.stripeSecretKey
          ? await findCustomerBySlugOrId(rawSlugOrId, cfg.stripeSecretKey).catch(() => null)
          : null;
        const targetSlug = slugifyName((client && client.demoSlug) || rawSlugOrId);

        let meta = null;
        const files = [];
        if (env && env.WYNN_KV && targetSlug) {
          meta = await env.WYNN_KV.get(`site_meta:${targetSlug}`, 'json').catch(() => null);
          const pathsToRead = (meta && Array.isArray(meta.filesList) && meta.filesList.length)
            ? meta.filesList
            : ['/index.html'];

          for (const p of pathsToRead) {
            const normPath = p.startsWith('/') ? p : '/' + p;
            const assetKey = `site_asset:${targetSlug}:${normPath}`;
            const isText = /\.(html?|css|m?js|json|svg|txt|md|xml)$/i.test(normPath);
            if (isText) {
              const txt = await env.WYNN_KV.get(assetKey, 'text').catch(() => null);
              if (txt !== null) {
                files.push({ path: normPath, type: getMimeType(normPath), text: txt });
              }
            } else {
              const obj = await env.WYNN_KV.getWithMetadata(assetKey, 'arrayBuffer').catch(() => null);
              if (obj && obj.value) {
                files.push({
                  path: normPath,
                  type: (obj.metadata && obj.metadata.mimeType) || getMimeType(normPath),
                  base64: arrayBufferToBase64(obj.value)
                });
              }
            }
          }
        }

        return new Response(JSON.stringify({
          ok: true,
          slug: targetSlug,
          demoUrl: `https://${targetSlug}.wynnpages.com.au`,
          client,
          meta,
          files
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4d. Lossless In-Place Palette Switcher (POST /api/switch-palette)
    if (url.pathname === '/api/switch-palette' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }

        if (!env || !env.WYNN_KV) {
          return new Response(JSON.stringify({ error: 'Cloudflare KV (WYNN_KV) is not bound or available!' }), { status: 500, headers: corsHeaders });
        }

        const validPalettes = ['01', '02', '03', '04', '05'];
        const targetPalette = String(body.palette || '').trim();
        if (!validPalettes.includes(targetPalette)) {
          return new Response(JSON.stringify({ error: 'Mã bộ màu không hợp lệ (hỗ trợ 01 - 05).' }), { status: 400, headers: corsHeaders });
        }

        const rawSlug = (body.slug || '').trim();
        const customerId = (body.customerId || '').trim();
        let targetSlug = slugifyName(rawSlug);
        let effectiveCfg = getConfig(env, body.credentials || {});

        if (!targetSlug && customerId && effectiveCfg.stripeSecretKey) {
          const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (cRes.ok) {
            const cust = await cRes.json();
            const formatted = formatCustomerRecord(cust);
            targetSlug = formatted.demoSlug;
          }
        }

        if (!targetSlug) {
          return new Response(JSON.stringify({ error: 'Thiếu slug tiệm cần đổi màu.' }), { status: 400, headers: corsHeaders });
        }

        // 1. Fetch index.html from KV
        const assetKey = `site_asset:${targetSlug}:/index.html`;
        let htmlText = await env.WYNN_KV.get(assetKey);
        if (!htmlText) {
          return new Response(JSON.stringify({ error: `Không tìm thấy index.html trong KV cho slug "${targetSlug}"!` }), { status: 404, headers: corsHeaders });
        }

        // 2. Perform lossless in-place replacement of data-palette and config.palette
        if (/data-palette=["']0[1-5]["']/.test(htmlText)) {
          htmlText = htmlText.replace(/data-palette=["']0[1-5]["']/, `data-palette="${targetPalette}"`);
        } else {
          htmlText = htmlText.replace(/<html([^>]*)>/, `<html$1 data-palette="${targetPalette}">`);
        }

        if (/palette:\s*['"]0[1-5]['"]/.test(htmlText)) {
          htmlText = htmlText.replace(/palette:\s*['"]0[1-5]['"]/, `palette: '${targetPalette}'`);
        }

        const nowIso = new Date().toISOString();
        await env.WYNN_KV.put(assetKey, htmlText, {
          metadata: { mimeType: 'text/html; charset=utf-8', size: htmlText.length, updatedAt: nowIso }
        });

        // 3. Update site_meta in KV
        const metaKey = `site_meta:${targetSlug}`;
        const prevMeta = await env.WYNN_KV.get(metaKey, 'json').catch(() => null);
        if (prevMeta) {
          prevMeta.palette = targetPalette;
          prevMeta.updatedAt = nowIso;
          await env.WYNN_KV.put(metaKey, JSON.stringify(prevMeta));
        }

        // 4. Update Stripe customer metadata if customerId is present
        let resolvedCustomerId = customerId;
        if (!resolvedCustomerId && effectiveCfg.stripeSecretKey) {
          const matched = await findCustomerBySlugOrId(targetSlug, effectiveCfg.stripeSecretKey).catch(() => null);
          if (matched && matched.id) resolvedCustomerId = matched.id;
        }
        if (resolvedCustomerId && effectiveCfg.stripeSecretKey) {
          const uParams = new URLSearchParams();
          uParams.append('metadata[demo_palette]', targetPalette);
          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(resolvedCustomerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          }).catch(() => {});
        }

        return new Response(JSON.stringify({
          ok: true,
          slug: targetSlug,
          palette: targetPalette,
          message: `Đã đổi chuẩn màu ${targetPalette} thành công!`
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message || 'Lỗi server khi đổi màu!' }), { status: 500, headers: corsHeaders });
      }
    }

    // ================================================================
    // POST-PAYMENT REVISION PORTAL API ENDPOINTS
    // ================================================================

    // 4e. Extract Demo Data for Side-by-Side Revision Portal (GET /api/revision/get-demo-data)
    if (url.pathname === '/api/revision/get-demo-data' && request.method === 'GET') {
      try {
        const cid = (url.searchParams.get('cid') || url.searchParams.get('client_id') || '').trim();
        const email = (url.searchParams.get('email') || '').trim();
        const sessionId = (url.searchParams.get('session_id') || '').trim();

        let paymentReconcile = null;
        if (sessionId && sessionId.startsWith('cs_') && cfg.stripeSecretKey) {
          paymentReconcile = await finalizeStripePaymentAndNotify({
            sessionId,
            origin: url.origin,
            env,
            ctx,
            cfg
          }).catch(() => null);
        }

        const effectiveCid = (paymentReconcile && paymentReconcile.cid) || cid;
        const effectiveEmail = (paymentReconcile && paymentReconcile.email) || email;

        let cust = null;
        if (effectiveCid && effectiveCid.startsWith('cus_') && cfg.stripeSecretKey) {
          cust = await findCustomerBySlugOrId(effectiveCid, cfg.stripeSecretKey);
        }
        if (!cust && effectiveEmail && cfg.stripeSecretKey) {
          cust = await findStripeCustomerByEmail(effectiveEmail, cfg.stripeSecretKey);
        }

        // Fallback/enrich from D1 clients table
        const dbRev = getD1(env);
        let d1Meta = null;
        if (dbRev) {
          await ensureD1Schema(env);
          let d1Row = null;
          if (effectiveCid) {
            d1Row = await dbRev.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(effectiveCid).first().catch(() => null);
          }
          if (!d1Row && (cust && cust.id)) {
            d1Row = await dbRev.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(cust.id).first().catch(() => null);
          }
          if (!d1Row && effectiveEmail) {
            d1Row = await dbRev.prepare('SELECT * FROM clients WHERE lower(email) = lower(?) LIMIT 1').bind(effectiveEmail).first().catch(() => null);
          }
          if (d1Row && d1Row.metadata_json) {
            try { d1Meta = JSON.parse(d1Row.metadata_json); } catch (_) {}
          }
          if (!d1Meta && d1Row) {
            d1Meta = {
              id: d1Row.id,
              email: d1Row.email,
              name: d1Row.name,
              businessName: d1Row.business_name,
              phone: d1Row.phone,
              demoSlug: d1Row.demo_slug,
              demoUrl: d1Row.demo_url,
              liveUrl: d1Row.live_url
            };
          }
        }

        if (!cust && !d1Meta) {
          return new Response(JSON.stringify({ ok: false, error: 'Customer not found' }), {
            status: 404,
            headers: corsHeaders
          });
        }

        const clientRecord = cust ? formatCustomerRecord(cust) : d1Meta;
        const resolvedClientId = (cust && cust.id) || (d1Meta && d1Meta.id) || effectiveCid;
        const cleanSlug = slugifyName(clientRecord.demoSlug || clientRecord.businessName || '');

        // Check revision data in D1 first, then KV, then Stripe metadata
        let savedRevData = (d1Meta && d1Meta.revisionData) || null;
        if (!savedRevData && env && env.WYNN_KV && resolvedClientId) {
          savedRevData = await env.WYNN_KV.get(`revision_data:${resolvedClientId}`, 'json').catch(() => null);
        }
        if (!savedRevData && cust && cust.metadata && cust.metadata.revision_json) {
          try {
            savedRevData = JSON.parse(cust.metadata.revision_json);
          } catch (_) {}
        }

        // Try to parse ATELIER_CONFIG, SALON_MENU_DATA, and live <img> tags from demo HTML in KV
        let demoConfig = null;
        let demoMenu = null;
        let rawDemoHtml = null;
        if (env && env.WYNN_KV && cleanSlug) {
          rawDemoHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.html`, 'text').catch(() => null);
          if (rawDemoHtml) {
            const parsed = parseConfigAndMenuFromHtml(rawDemoHtml);
            demoConfig = parsed.config;
            demoMenu = parsed.menu;
          }
        }

        // Dynamically extract ACTUAL live Demo artwork / photos from the client's Demo HTML & config
        const demoBaseOrigin = cleanSlug ? `https://${cleanSlug}.wynnpages.com.au` : url.origin;
        const resolveDemoAssetUrl = (u) => {
          if (!u || typeof u !== 'string') return '';
          const trimmed = u.trim();
          if (!trimmed) return '';
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:')) return trimmed;
          if (trimmed.startsWith('./')) return `${demoBaseOrigin}/${trimmed.slice(2)}`;
          if (trimmed.startsWith('/')) {
            if (trimmed.startsWith('/assets/atelier/') || trimmed.startsWith('/api/places-photo')) {
              return `https://wynnpages.com.au${trimmed}`;
            }
            return `${demoBaseOrigin}${trimmed}`;
          }
          return `${demoBaseOrigin}/${trimmed}`;
        };

        const palMatch = rawDemoHtml && rawDemoHtml.match(/data-palette=["'](0[1-5])["']/);
        const activePalette = (demoConfig && demoConfig.palette) || (palMatch && palMatch[1]) || clientRecord.demoPalette || '01';
        const vaultBase = 'https://wynnpages.com.au/assets/atelier/nails';
        const paletteVaultMap = {
          '01': {
            hero: `${vaultBase}/hero-sanctuary.jpg`,
            biab: `${vaultBase}/biab-artistry.jpg`,
            pedi: `${vaultBase}/botanical-pedicure.jpg`,
            french: `${vaultBase}/micro-french-lookbook.jpg`
          },
          '02': {
            hero: `${vaultBase}/p02/hero.jpg`,
            biab: `${vaultBase}/p02/biab.jpg`,
            pedi: `${vaultBase}/p02/pedicure.jpg`,
            french: `${vaultBase}/p02/lookbook.jpg`
          },
          '03': {
            hero: `${vaultBase}/p03/hero.jpg`,
            biab: `${vaultBase}/p03/biab.jpg`,
            pedi: `${vaultBase}/p03/pedicure.jpg`,
            french: `${vaultBase}/p03/lookbook.jpg`
          },
          '04': {
            hero: `${vaultBase}/p04/hero.jpg`,
            biab: `${vaultBase}/p04/biab.jpg`,
            pedi: `${vaultBase}/p04/pedicure.jpg`,
            french: `${vaultBase}/p04/lookbook.jpg`
          },
          '05': {
            hero: `${vaultBase}/p05/hero.jpg`,
            biab: `${vaultBase}/p05/biab.jpg`,
            pedi: `${vaultBase}/p05/pedicure.jpg`,
            french: `${vaultBase}/p05/lookbook.jpg`
          }
        };
        const palDefaults = paletteVaultMap[activePalette] || paletteVaultMap['01'];

        const extractImgById = (htmlStr, idName) => {
          if (!htmlStr) return '';
          const re1 = new RegExp(`<img[^>]*id=["']${idName}["'][^>]*src=["']([^"']+)["']`, 'i');
          const m1 = htmlStr.match(re1);
          if (m1 && m1[1]) return m1[1];
          const re2 = new RegExp(`<img[^>]*src=["']([^"']+)["'][^>]*id=["']${idName}["']`, 'i');
          const m2 = htmlStr.match(re2);
          return (m2 && m2[1]) || '';
        };

        const demoPhotosList = [];
        const seenPhotoUrls = new Set();
        const pushDemoPhoto = (rawUrl, label) => {
          const fullUrl = resolveDemoAssetUrl(rawUrl);
          if (!fullUrl || seenPhotoUrls.has(fullUrl)) return;
          if (/favicon|logo|og-share/i.test(fullUrl)) return;
          seenPhotoUrls.add(fullUrl);
          const isDefaultStock = /\/assets\/atelier\/nails\/(?:p0[2-5]\/)?(?:hero-sanctuary|biab-artistry|botanical-pedicure|micro-french-lookbook|hero|biab|pedicure|lookbook)\.jpg$/i.test(fullUrl);
          demoPhotosList.push({
            url: fullUrl,
            label: label || `Demo Photo ${demoPhotosList.length + 1}`,
            isCustom: !isDefaultStock
          });
        };

        const cfgImgs = (demoConfig && demoConfig.images) || {};
        pushDemoPhoto(cfgImgs.hero || extractImgById(rawDemoHtml, 'hero-oil-img') || palDefaults.hero, 'Sanctuary Hero');
        pushDemoPhoto(cfgImgs.biabFeature || extractImgById(rawDemoHtml, 'feature-biab-img') || extractImgById(rawDemoHtml, 'ba-after-img') || palDefaults.biab, 'Signature Nail Craft');
        pushDemoPhoto(cfgImgs.pedicureFeature || extractImgById(rawDemoHtml, 'feature-pedicure-img') || extractImgById(rawDemoHtml, 'feature-pedi-img') || extractImgById(rawDemoHtml, 'ba-before-img') || palDefaults.pedi, 'Botanical Pedicure');

        if (Array.isArray(cfgImgs.lookbook)) {
          cfgImgs.lookbook.forEach((item, idx) => {
            const u = typeof item === 'string' ? item : (item && (item.src || item.url || item.image));
            const lbl = (item && (item.title || item.caption || item.label)) || `Lookbook ${idx + 1}`;
            if (u) pushDemoPhoto(u, lbl);
          });
        }

        if (rawDemoHtml) {
          const lookbookSectionMatch = rawDemoHtml.match(/<section[^>]*id=["']lookbook["'][\s\S]*?<\/section>/i);
          const scanChunk = lookbookSectionMatch ? lookbookSectionMatch[0] : rawDemoHtml;
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
          let mImg;
          while ((mImg = imgRegex.exec(scanChunk)) !== null && demoPhotosList.length < 6) {
            const srcVal = mImg[1];
            const altMatch = mImg[0].match(/alt=["']([^"']+)["']/i);
            const altText = altMatch && altMatch[1] ? altMatch[1].split(/[—•|-]/)[0].trim().slice(0, 28) : '';
            pushDemoPhoto(srcVal, altText || `Gallery ${demoPhotosList.length + 1}`);
          }
        }

        if (demoPhotosList.length < 4) {
          pushDemoPhoto(palDefaults.french, 'Micro-French');
        }

        const hasCustomDemoPhotos = demoPhotosList.some(p => p.isCustom);
        const resolvedLogoUrl = resolveDemoAssetUrl((demoConfig && (demoConfig.wordmarkUrl || demoConfig.logoUrl)) || clientRecord.logoDriveUrl || '');

        const clientResp = {
          id: resolvedClientId,
          email: clientRecord.email || effectiveEmail || '',
          dealStatus: clientRecord.dealStatus || 'standard',
          liveUrl: clientRecord.liveUrl || '',
          existingDomain: clientRecord.existingDomain || '',
          desiredDomains: clientRecord.desiredDomains || '',
          domainDelegated: Boolean(clientRecord.domainDelegated),
          logoUrl: resolvedLogoUrl,
          businessName: (demoConfig && demoConfig.salonName) || clientRecord.businessName || clientRecord.name,
          displayPhone: (demoConfig && demoConfig.displayPhone) || clientRecord.displayPhone || clientRecord.phone,
          phone: clientRecord.phone || (demoConfig && demoConfig.smsPhone),
          businessAddress: (demoConfig && demoConfig.address) || clientRecord.businessAddress,
          address: (demoConfig && demoConfig.address) || clientRecord.businessAddress,
          hours: (demoConfig && demoConfig.hours) || null,
          openingHours: clientRecord.openingHours || '',
          bookingUrl: (demoConfig && demoConfig.bookingUrl) || '',
          heroBadge: (demoConfig && demoConfig.heroBadge) || '',
          heroHeadline: (demoConfig && ((demoConfig.heroHeadlinePrefix || '') + ' ' + (demoConfig.heroHeadlineItalic || '')).trim()) || 'Quiet luxury for artful hands.',
          heroStory: (demoConfig && demoConfig.heroStory) || '',
          menu: demoMenu || null,
          photos: demoPhotosList.map(p => p.url),
          demoPhotos: demoPhotosList,
          hasCustomDemoPhotos,
          demoPalette: activePalette,
          demoUrl: clientRecord.demoUrl || clientRecord.brandedDemoUrl,
          demoSlug: clientRecord.demoSlug || cleanSlug
        };

        const revStatus = (cust && cust.metadata && cust.metadata.revision_status)
          || (d1Meta && d1Meta.revisionStatus)
          || (savedRevData && savedRevData.submittedAt ? 'submitted' : (savedRevData ? 'draft' : 'pending'));
        const revSubmittedAt = (cust && cust.metadata && cust.metadata.revision_submitted_at)
          || (d1Meta && d1Meta.revisionSubmittedAt)
          || (savedRevData && savedRevData.submittedAt)
          || '';
        const revDraftAt = (d1Meta && d1Meta.revisionDraftAt)
          || (savedRevData && savedRevData.draftSavedAt)
          || '';

        return new Response(JSON.stringify({
          ok: true,
          client: clientResp,
          revisionStatus: revStatus,
          revisionSubmittedAt: revSubmittedAt,
          revisionDraftAt: revDraftAt,
          revisionData: savedRevData
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4f. Submit & Lock OR Save Draft of Revision Round (POST /api/revision/submit | POST /api/revision/save-draft)
    if ((url.pathname === '/api/revision/submit' || url.pathname === '/api/revision/save-draft') && request.method === 'POST') {
      try {
        const isDraft = url.pathname === '/api/revision/save-draft';
        const body = await request.json().catch(() => ({}));
        const cid = (body.cid || body.client_id || '').trim();
        const email = (body.email || '').trim();
        if (!cid && !email) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing cid or email' }), { status: 400, headers: corsHeaders });
        }

        let cust = null;
        if (cid && cid.startsWith('cus_') && cfg.stripeSecretKey) {
          cust = await findCustomerBySlugOrId(cid, cfg.stripeSecretKey);
        }
        if (!cust && email && cfg.stripeSecretKey) {
          cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
        }

        const dbRevPost = getD1(env);
        let d1RowMeta = null;
        if (dbRevPost) {
          await ensureD1Schema(env);
          let d1Row = null;
          if (cid) d1Row = await dbRevPost.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(cid).first().catch(() => null);
          if (!d1Row && cust && cust.id) d1Row = await dbRevPost.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(cust.id).first().catch(() => null);
          if (!d1Row && email) d1Row = await dbRevPost.prepare('SELECT * FROM clients WHERE lower(email) = lower(?) LIMIT 1').bind(email).first().catch(() => null);
          if (d1Row && d1Row.metadata_json) {
            try { d1RowMeta = JSON.parse(d1Row.metadata_json); } catch (_) {}
          }
          if (!d1RowMeta && d1Row) {
            d1RowMeta = {
              id: d1Row.id,
              email: d1Row.email,
              name: d1Row.name,
              businessName: d1Row.business_name,
              phone: d1Row.phone,
              demoSlug: d1Row.demo_slug,
              demoUrl: d1Row.demo_url,
              liveUrl: d1Row.live_url
            };
          }
        }

        if (!cust && !d1RowMeta) {
          return new Response(JSON.stringify({ ok: false, error: 'Customer not found' }), { status: 404, headers: corsHeaders });
        }

        const nowIso = new Date().toISOString();
        const clientRecord = cust ? formatCustomerRecord(cust) : d1RowMeta;
        const resolvedClientId = (cust && cust.id) || (d1RowMeta && d1RowMeta.id) || cid;
        const cleanSlug = slugifyName(clientRecord.demoSlug || clientRecord.businessName || '');

        let prevRevData = (d1RowMeta && d1RowMeta.revisionData) || null;
        if (!prevRevData && env && env.WYNN_KV && resolvedClientId) {
          prevRevData = await env.WYNN_KV.get(`revision_data:${resolvedClientId}`, 'json').catch(() => null);
        }

        // Save uploaded multi-file Menu list (up to 4 files) & Salon Photos (up to 6 photos)
        let savedMenuFiles = Array.isArray(prevRevData && prevRevData.menuFiles) ? prevRevData.menuFiles : [];
        let savedMenuUrl = (prevRevData && prevRevData.menuFileUrl) || '';

        if (Array.isArray(body.menuFiles)) {
          const nextMenuFiles = [];
          const menuB64List = [];
          const incomingMenus = body.menuFiles.slice(0, 4);
          for (let i = 0; i < incomingMenus.length; i++) {
            const item = incomingMenus[i];
            if (!item) continue;
            const rawName = String(item.name || `menu-${i + 1}.jpg`).trim();
            if (item.dataUrl && String(item.dataUrl).startsWith('data:') && env && env.WYNN_KV) {
              const isPdf = String(item.dataUrl).startsWith('data:application/pdf');
              const mExt = isPdf ? 'pdf' : ((rawName.includes('.') ? rawName.split('.').pop().toLowerCase() : 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg');
              const assetPath = `/assets/menu-revision-${i + 1}.${mExt}`;
              const mKey = `site_asset:${cleanSlug}:${assetPath}`;
              const base64Data = String(item.dataUrl).replace(/^data:[^;]+;base64,/, '');
              const binaryBuf = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              const mimeType = isPdf ? 'application/pdf' : 'image/jpeg';
              await env.WYNN_KV.put(mKey, binaryBuf.buffer, {
                metadata: { mimeType, contentType: mimeType }
              }).catch(() => {});
              menuB64List.push(item.dataUrl);
              if (i === 0) {
                await env.WYNN_KV.put(`revision_file:${resolvedClientId}:menu`, item.dataUrl).catch(() => {});
              }
              const publicUrl = `https://${cleanSlug}.wynnpages.com.au${assetPath}?t=${Date.now()}`;
              nextMenuFiles.push({ name: rawName, url: publicUrl, assetPath, type: mimeType });
            } else if (item.url) {
              nextMenuFiles.push({ name: rawName, url: String(item.url), type: item.type || 'image/jpeg' });
            }
          }
          if (menuB64List.length > 0 && env && env.WYNN_KV) {
            await env.WYNN_KV.put(`revision_file:${resolvedClientId}:menu_list`, JSON.stringify(menuB64List)).catch(() => {});
          }
          savedMenuFiles = nextMenuFiles;
          savedMenuUrl = (savedMenuFiles[0] && savedMenuFiles[0].url) || '';
        } else if (body.menuFileBase64 && env && env.WYNN_KV) {
          const mExt = (body.menuFileName && body.menuFileName.includes('.')) ? body.menuFileName.split('.').pop() : 'jpg';
          const mKey = `site_asset:${cleanSlug}:/assets/menu-revision.${mExt}`;
          const base64Data = body.menuFileBase64.replace(/^data:[^;]+;base64,/, '');
          const binaryBuf = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
          const mimeType = body.menuFileBase64.startsWith('data:application/pdf') ? 'application/pdf' : 'image/jpeg';
          await env.WYNN_KV.put(mKey, binaryBuf.buffer, {
            metadata: { mimeType, contentType: mimeType }
          }).catch(() => {});
          await env.WYNN_KV.put(`revision_file:${resolvedClientId}:menu`, body.menuFileBase64).catch(() => {});
          savedMenuUrl = `https://${cleanSlug}.wynnpages.com.au/assets/menu-revision.${mExt}`;
          savedMenuFiles = [{ name: body.menuFileName || `menu.${mExt}`, url: savedMenuUrl, type: mimeType }];
        }

        let savedSalonPhotos = Array.isArray(prevRevData && prevRevData.salonPhotos) ? prevRevData.salonPhotos : [];
        if (Array.isArray(body.salonPhotos)) {
          const nextSalonPhotos = [];
          const incomingPhotos = body.salonPhotos.slice(0, 6);
          for (let i = 0; i < incomingPhotos.length; i++) {
            const item = incomingPhotos[i];
            if (!item) continue;
            const rawName = String(item.name || `salon-photo-${i + 1}.jpg`).trim();
            if (item.dataUrl && String(item.dataUrl).startsWith('data:') && env && env.WYNN_KV) {
              const pExt = (rawName.includes('.') ? rawName.split('.').pop().toLowerCase() : 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg';
              const assetPath = `/assets/client-photo-${i + 1}.${pExt}`;
              const pKey = `site_asset:${cleanSlug}:${assetPath}`;
              const base64Data = String(item.dataUrl).replace(/^data:[^;]+;base64,/, '');
              const binaryBuf = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
              await env.WYNN_KV.put(pKey, binaryBuf.buffer, {
                metadata: { mimeType: 'image/jpeg', contentType: 'image/jpeg' }
              }).catch(() => {});
              if (i === 0) {
                await env.WYNN_KV.put(`revision_file:${resolvedClientId}:photos`, item.dataUrl).catch(() => {});
              }
              const publicUrl = `https://${cleanSlug}.wynnpages.com.au${assetPath}?t=${Date.now()}`;
              nextSalonPhotos.push({ name: rawName, url: publicUrl, type: 'image/jpeg' });
            } else if (item.url) {
              nextSalonPhotos.push({ name: rawName, url: String(item.url), type: item.type || 'image/jpeg' });
            }
          }
          savedSalonPhotos = nextSalonPhotos;
        } else if (body.photosFileBase64 && env && env.WYNN_KV) {
          await env.WYNN_KV.put(`revision_file:${resolvedClientId}:photos`, body.photosFileBase64).catch(() => {});
        }

        const resolvedMenuFileName = savedMenuFiles.length
          ? savedMenuFiles.map(f => f.name).join(', ')
          : (body.menuFileName || (prevRevData && prevRevData.menuFileName) || '');
        const resolvedPhotosFileName = savedSalonPhotos.length
          ? savedSalonPhotos.map(f => f.name).join(', ')
          : (body.photosFileName || (prevRevData && prevRevData.photosFileName) || '');

        // Save optional uploaded Brand Logo into KV (`site_asset:${cleanSlug}:/assets/client-logo.${ext}`)
        let savedLogoUrl = (prevRevData && prevRevData.logoUrl) || '';
        let savedLogoFileName = (prevRevData && prevRevData.logoFileName) || '';
        let savedLogoAssetPath = '';
        if (body.logoFile && body.logoFile.dataUrl && String(body.logoFile.dataUrl).startsWith('data:') && env && env.WYNN_KV && cleanSlug) {
          const rawLogoName = String(body.logoFile.name || 'client-logo.png').trim();
          const dataStr = String(body.logoFile.dataUrl);
          const mimeMatch = dataStr.match(/^data:([^;,]+)(?:;[^,]*)?,(.*)$/s);
          const lMime = (mimeMatch && mimeMatch[1]) || body.logoFile.type || 'image/png';
          const isSvg = lMime.includes('svg') || rawLogoName.toLowerCase().endsWith('.svg');
          const lExt = isSvg ? 'svg' : (lMime.includes('jpeg') || lMime.includes('jpg') ? 'jpg' : (lMime.includes('webp') ? 'webp' : 'png'));
          savedLogoAssetPath = `/assets/client-logo.${lExt}`;
          const lKey = `site_asset:${cleanSlug}:${savedLogoAssetPath}`;
          if (dataStr.includes(';base64,')) {
            const b64Part = dataStr.replace(/^data:[^;]+;base64,/, '');
            const binBuf = Uint8Array.from(atob(b64Part), ch => ch.charCodeAt(0));
            await env.WYNN_KV.put(lKey, binBuf.buffer, {
              metadata: { mimeType: lMime, contentType: lMime, updatedAt: nowIso }
            }).catch(() => {});
          } else if (mimeMatch && mimeMatch[2]) {
            const textPayload = decodeURIComponent(mimeMatch[2]);
            await env.WYNN_KV.put(lKey, textPayload, {
              metadata: { mimeType: lMime, contentType: lMime, updatedAt: nowIso }
            }).catch(() => {});
          }
          savedLogoUrl = `https://${cleanSlug}.wynnpages.com.au${savedLogoAssetPath}?t=${Date.now()}`;
          savedLogoFileName = rawLogoName;

          const curMetaKey = `site_meta:${cleanSlug}`;
          const curMeta = await env.WYNN_KV.get(curMetaKey, 'json').catch(() => null);
          if (curMeta && Array.isArray(curMeta.filesList)) {
            curMeta.filesList = Array.from(new Set([...curMeta.filesList, savedLogoAssetPath]));
            curMeta.filesCount = curMeta.filesList.length;
            await env.WYNN_KV.put(curMetaKey, JSON.stringify(curMeta)).catch(() => {});
          }

          if (!isDraft) {
            const liveHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.html`, 'text').catch(() => null);
            if (liveHtml) {
              const parsedLive = parseConfigAndMenuFromHtml(liveHtml);
              if (parsedLive && parsedLive.config) {
                parsedLive.config.logoUrl = savedLogoAssetPath;
                const patchedHtml = updateHtmlWithConfigAndMenu(liveHtml, parsedLive.config, null);
                await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, patchedHtml, {
                  metadata: { mimeType: 'text/html; charset=utf-8', updatedAt: nowIso }
                }).catch(() => {});
              }
            }
          }
        } else if (body.logoFile && body.logoFile.url) {
          savedLogoUrl = String(body.logoFile.url);
          savedLogoFileName = String(body.logoFile.name || 'client-logo.png');
        } else if (body.logoFile === null) {
          savedLogoUrl = '';
          savedLogoFileName = '';
        }

        const revPayload = {
          cid: resolvedClientId,
          email: (cust && cust.email) || clientRecord.email || email,
          bizName: body.bizName || '',
          phone: body.phone || '',
          address: body.address || '',
          hours: body.hours || '',
          bookingUrl: body.bookingUrl || '',
          heroHeadline: body.heroHeadline || '',
          heroStory: body.heroStory || '',
          menuText: body.menuText || '',
          menuFileName: resolvedMenuFileName,
          menuFileUrl: savedMenuUrl,
          menuFiles: savedMenuFiles,
          photosFileName: resolvedPhotosFileName,
          salonPhotos: savedSalonPhotos,
          logoUrl: savedLogoUrl,
          logoFileName: savedLogoFileName,
          domainConciergeRequested: Boolean(body.domainConciergeRequested),
          desiredDomain: body.desiredDomain || '',
          notes: body.notes || '',
          ...(isDraft ? { draftSavedAt: nowIso, isDraft: true } : { submittedAt: nowIso, isDraft: false })
        };

        // Store revision JSON in KV as well (explicit save/submit action, not polling)
        if (env && env.WYNN_KV) {
          await env.WYNN_KV.put(`revision_data:${resolvedClientId}`, JSON.stringify(revPayload)).catch(() => {});
        }

        // If Save Draft: store in D1 & Stripe draft status WITHOUT locking and WITHOUT sending notifications
        if (isDraft) {
          if (cust && cust.id && cfg.stripeSecretKey) {
            const draftP = new URLSearchParams();
            draftP.append('metadata[revision_status]', 'draft');
            draftP.append('metadata[revision_draft_at]', nowIso);
            await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: draftP.toString()
            }).catch(() => {});
          }
          await upsertD1Client(env, {
            ...clientRecord,
            id: resolvedClientId,
            revisionStatus: 'draft',
            revisionDraftAt: nowIso,
            revisionData: revPayload
          });
          return new Response(JSON.stringify({
            ok: true,
            draft: true,
            savedAt: nowIso,
            revisionData: revPayload,
            message: 'Draft saved! You can safely close this page and return later.'
          }), { status: 200, headers: corsHeaders });
        }

        // Build summary text for Stripe metadata
        const summaryParts = [];
        if (savedLogoFileName) summaryParts.push(`Logo: ${savedLogoFileName}`);
        if (revPayload.bizName) summaryParts.push(`Name: ${revPayload.bizName}`);
        if (revPayload.phone) summaryParts.push(`Phone: ${revPayload.phone}`);
        if (revPayload.address) summaryParts.push(`Addr: ${revPayload.address}`);
        if (revPayload.menuText || revPayload.menuFileName) summaryParts.push(`Menu: ${revPayload.menuFileName || 'Text tweaks'}`);
        if (savedSalonPhotos.length) summaryParts.push(`Photos: ${savedSalonPhotos.length} uploaded`);
        if (revPayload.domainConciergeRequested) summaryParts.push(`Domain Help Requested (${revPayload.desiredDomain || 'Concierge'})`);
        if (revPayload.notes) summaryParts.push(`Notes: ${revPayload.notes}`);
        const revSummary = summaryParts.join(' • ') || 'Comprehensive 1-round revisions submitted';

        // Notify Studio Admin (App/Telegram) immediately with detailed breakdown
        const notifyBizName = revPayload.bizName || clientRecord.businessName || 'Khách hàng';
        const tgDetails = [
          `🏢 Tiệm: ${notifyBizName}`,
          savedLogoFileName ? `✨ Logo mới tải lên: ${savedLogoFileName}` : '',
          revPayload.phone ? `📞 SĐT hiển thị: ${revPayload.phone}` : '',
          revPayload.address ? `📍 Địa chỉ: ${revPayload.address}` : '',
          revPayload.hours ? `🕒 Giờ mở cửa: ${revPayload.hours}` : '',
          savedMenuFiles.length ? `📋 Ảnh Menu tải lên: ${savedMenuFiles.length} trang (${revPayload.menuFileName})` : '',
          revPayload.menuText ? `✏️ Ghi chú sửa giá: ${revPayload.menuText.slice(0, 160)}` : '',
          savedSalonPhotos.length ? `📸 Ảnh tiệm tải lên: ${savedSalonPhotos.length} ảnh` : '',
          revPayload.desiredDomain ? `🌐 Tên miền mong muốn: ${revPayload.desiredDomain}` : '',
          revPayload.domainConciergeRequested ? `🆘 KHÁCH NHỜ STUDIO CÀI ĐẶT TÊN MIỀN HỘ A–Z!` : '',
          revPayload.notes ? `💬 Chỉ đạo cuối: ${revPayload.notes.slice(0, 200)}` : '',
          `\n👉 Mở Admin bấm nút "🤖 Sửa Đổi & AI" để Gemini tự động cập nhật ngay!`
        ].filter(Boolean).join('\n');

        await recordActivityAndNotify({
          type: 'revision_submitted',
          title: revPayload.domainConciergeRequested
            ? '🆘 Khách Gửi Sửa Web + Nhờ Cài Tên Miền A–Z!'
            : '📝 Khách Đã Gửi Sửa Web (1 Vòng)!',
          message: tgDetails,
          clientName: notifyBizName,
          slug: cleanSlug,
          env,
          ctx
        });
        await upsertD1Client(env, {
          ...clientRecord,
          id: resolvedClientId,
          businessName: revPayload.bizName || clientRecord.businessName,
          displayPhone: revPayload.phone || clientRecord.displayPhone,
          businessAddress: revPayload.address || clientRecord.businessAddress,
          desiredDomains: revPayload.desiredDomain || clientRecord.desiredDomains,
          domainConciergeRequested: Boolean(revPayload.domainConciergeRequested),
          revisionStatus: 'submitted',
          revisionSubmittedAt: nowIso,
          revisionSummary: revSummary,
          revisionMenuFileName: revPayload.menuFileName || '',
          revisionMenuFileUrl: savedMenuUrl || '',
          revisionPhotosFileName: revPayload.photosFileName || '',
          revisionData: revPayload
        });

        // Always send Confirmation / Domain Guide Email + SMS to Client on final revision submission
        const clientNotifyTask = triggerLifecycleNotification({
          stage: 'outbound_revision_submitted',
          client: {
            id: resolvedClientId,
            name: clientRecord.name || revPayload.bizName || '',
            businessName: revPayload.bizName || clientRecord.businessName || clientRecord.name || '',
            email: (cust && cust.email) || email || clientRecord.email || '',
            phone: clientRecord.phone || clientRecord.displayPhone || revPayload.phone || '',
            liveUrl: clientRecord.liveUrl || '',
            existingDomain: clientRecord.existingDomain || '',
            desiredDomains: revPayload.desiredDomain || clientRecord.desiredDomains || '',
            domainDelegated: Boolean(clientRecord.domainDelegated),
            domainConciergeRequested: Boolean(revPayload.domainConciergeRequested)
          },
          origin: url.origin,
          cfg,
          env,
          ctx,
          waitForTelegram: true
        }).catch((err) => ({ error: err.message }));

        let adminEmailTask = Promise.resolve(null);
        if (cfg.resendApiKey) {
          const bizLabel = revPayload.bizName || clientRecord.businessName || 'Client';
          const emailHtml = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fcf9f3;border:1px solid #e5dec9;border-radius:18px;">
              <h2 style="color:#96432b;margin-top:0;font-size:20px;">⚡ [1-ROUND REVISION SUBMITTED] ${bizLabel}!</h2>
              <p style="font-size:14px;color:#2b251e;line-height:1.5;"><strong>${bizLabel}</strong> just submitted their single complimentary revision round on the portal.</p>
              <div style="background:#fff;border:1px solid #d5cebf;border-radius:12px;padding:14px;margin:16px 0;font-size:13px;line-height:1.6;">
                <div><strong>Business:</strong> ${bizLabel}</div>
                <div><strong>Summary:</strong> ${revSummary}</div>
                ${revPayload.menuText ? `<div><strong>Menu Tweaks:</strong> <pre style="background:#f8f9fa;padding:8px;border-radius:6px;font-family:monospace;white-space:pre-wrap;">${revPayload.menuText}</pre></div>` : ''}
                ${savedMenuUrl ? `<div><strong>Uploaded Menu:</strong> <a href="${savedMenuUrl}" target="_blank">${revPayload.menuFileName || 'View Menu'}</a></div>` : ''}
                ${revPayload.notes ? `<div><strong>Final Notes:</strong> <em>"${revPayload.notes}"</em></div>` : ''}
              </div>
              <p style="margin-top:20px;"><a href="https://wynnpages.com.au/admin" style="display:inline-block;background:#96432b;color:#ffffff;text-decoration:none;font-weight:bold;font-size:13px;padding:12px 22px;border-radius:12px;">Open Admin &amp; Run 1-Click AI Auto-Edit →</a></p>
            </div>
          `;
          adminEmailTask = sendResendEmail({
            to: 'hello@wynnpages.com.au',
            subject: `⚡ [1-ROUND REVISION] ${bizLabel} submitted updates!`,
            html: emailHtml,
            cfg
          }).catch(() => null);
        }

        const [clientNotifyRes] = await Promise.all([clientNotifyTask, adminEmailTask]);
        const domainGuideDelivered = Boolean(
          clientNotifyRes && (
            (clientNotifyRes.emailResult && clientNotifyRes.emailResult.sent) ||
            (clientNotifyRes.smsResult && clientNotifyRes.smsResult.sent)
          )
        );

        // Update Stripe Customer metadata (revision lock + domain guide delivery logs)
        if (cfg.stripeSecretKey && cust && cust.id) {
          const uP = new URLSearchParams();
          uP.append('metadata[revision_status]', 'submitted');
          uP.append('metadata[revision_submitted_at]', nowIso);
          uP.append('metadata[revision_summary]', revSummary.slice(0, 480));
          if (revPayload.menuFileName) uP.append('metadata[revision_menu_file_name]', revPayload.menuFileName.slice(0, 200));
          if (savedMenuUrl) uP.append('metadata[revision_menu_file_url]', savedMenuUrl.slice(0, 480));
          if (revPayload.photosFileName) uP.append('metadata[revision_photos_file_name]', revPayload.photosFileName.slice(0, 200));
          if (domainGuideDelivered) {
            uP.append('metadata[domain_guide_sent]', 'true');
            uP.append('metadata[domain_guide_sent_at]', nowIso);
          }
          if (clientNotifyRes && clientNotifyRes.smsResult) {
            const smsSummary = clientNotifyRes.smsResult.sent
              ? `OK (${clientNotifyRes.smsResult.to}) [outbound_revision_submitted] @ ${nowIso}`
              : `ERR: ${clientNotifyRes.smsResult.reason || 'Skipped'} [outbound_revision_submitted]`;
            uP.append('metadata[last_sms_log]', smsSummary.slice(0, 480));
          }
          if (clientNotifyRes && clientNotifyRes.emailResult) {
            const emailSummary = clientNotifyRes.emailResult.sent
              ? `OK (${clientNotifyRes.emailResult.to}) [outbound_revision_submitted] @ ${nowIso}`
              : `ERR: ${clientNotifyRes.emailResult.reason || 'Skipped'} [outbound_revision_submitted]`;
            uP.append('metadata[last_email_log]', emailSummary.slice(0, 480));
          }

          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          }).catch(() => {});
        }

        const updatedClientForD1 = {
          ...clientRecord,
          id: resolvedClientId,
          businessName: clientRecord.businessName,
          revisionStatus: 'submitted',
          revisionSubmittedAt: nowIso,
          revisionData: revPayload
        };
        await upsertD1Client(env, updatedClientForD1);
        await syncClientsKvSnapshot(env);

        return new Response(JSON.stringify({
          ok: true,
          message: 'Revisions locked and submitted successfully.',
          domainGuideSent: domainGuideDelivered,
          notification: clientNotifyRes
        }), {
          status: 200,
          headers: corsHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4f-2. Get Revision Attached File (GET /api/revision/get-file?cid=...&type=menu|photos)
    if (url.pathname === '/api/revision/get-file' && request.method === 'GET') {
      try {
        const cid = (url.searchParams.get('cid') || '').trim();
        const type = (url.searchParams.get('type') || 'menu').trim(); // 'menu' or 'photos'
        if (!cid) {
          return new Response('Missing cid', { status: 400 });
        }

        let base64Data = null;
        if (env && env.WYNN_KV) {
          base64Data = await env.WYNN_KV.get(`revision_file:${cid}:${type}`, 'text').catch(() => null);
        }

        if (!base64Data) {
          return new Response('File not found in KV', { status: 404 });
        }

        // Format is data:[mime];base64,[data]
        let mime = 'image/jpeg';
        let rawB64 = base64Data;
        const match = base64Data.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) {
          mime = match[1];
          rawB64 = match[2];
        }

        const binStr = atob(rawB64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }

        return new Response(bytes.buffer, {
          status: 200,
          headers: {
            'Content-Type': mime,
            'Cache-Control': 'public, max-age=86400',
            ...corsHeaders
          }
        });
      } catch (err) {
        return new Response('Error retrieving file: ' + err.message, { status: 500 });
      }
    }

    // 4f-3. Onboarding Brief Cloud Save Draft & Resume (GET /api/onboarding/get-draft | POST /api/onboarding/save-draft)
    if (url.pathname === '/api/onboarding/get-draft' && request.method === 'GET') {
      try {
        const cid = (url.searchParams.get('cid') || url.searchParams.get('client_id') || '').trim();
        const email = (url.searchParams.get('email') || '').trim().toLowerCase();
        const sessionId = (url.searchParams.get('session_id') || '').trim();
        const keys = [];
        if (cid) keys.push(`onboarding_draft:cid:${cid}`);
        if (email) keys.push(`onboarding_draft:email:${email}`);
        if (sessionId) keys.push(`onboarding_draft:sid:${sessionId}`);

        let draft = null;
        const dbOb = getD1(env);
        if (dbOb && keys.length > 0) {
          await ensureD1Schema(env);
          for (const k of keys) {
            const row = await dbOb.prepare('SELECT value, updated_at FROM settings WHERE key = ? LIMIT 1').bind(k).first().catch(() => null);
            if (row && row.value) {
              try {
                draft = JSON.parse(row.value);
                if (draft) break;
              } catch (_) {}
            }
          }
        }
        return new Response(JSON.stringify({ ok: true, draft }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/onboarding/save-draft' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const cid = String(body.cid || body.client_id || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const sessionId = String(body.sessionId || body.session_id || '').trim();
        const nowIso = new Date().toISOString();

        const keys = [];
        if (cid) keys.push(`onboarding_draft:cid:${cid}`);
        if (email) keys.push(`onboarding_draft:email:${email}`);
        if (sessionId) keys.push(`onboarding_draft:sid:${sessionId}`);

        if (keys.length === 0) {
          return new Response(JSON.stringify({ ok: false, error: 'Please enter your email or open via your personal onboarding link to save a draft.' }), { status: 400, headers: corsHeaders });
        }

        const draftPayload = {
          cid,
          email: String(body.email || '').trim(),
          sessionId,
          briefType: String(body.briefType || 'organic'),
          currentStep: Number(body.currentStep || 1),
          businessName: String(body.businessName || ''),
          displayPhone: String(body.displayPhone || ''),
          businessAddress: String(body.businessAddress || ''),
          socialLinks: String(body.socialLinks || ''),
          logoFileName: String(body.logoFileName || ''),
          logoLink: String(body.logoLink || ''),
          menuFileName: String(body.menuFileName || ''),
          menuLink: String(body.menuLink || ''),
          hasPhotos: String(body.hasPhotos || ''),
          photosFileName: String(body.photosFileName || ''),
          photosLink: String(body.photosLink || ''),
          brandColors: String(body.brandColors || ''),
          vibeLinks: String(body.vibeLinks || ''),
          hasDomain: String(body.hasDomain || ''),
          existingDomain: String(body.existingDomain || ''),
          desiredDomains: String(body.desiredDomains || ''),
          savedAt: nowIso
        };

        const dbOb = getD1(env);
        if (dbOb) {
          await ensureD1Schema(env);
          const payloadStr = JSON.stringify(draftPayload);
          const stmts = keys.map((k) =>
            dbOb.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
              .bind(k, payloadStr, nowIso)
          );
          await dbOb.batch(stmts).catch(() => {});
        }

        return new Response(JSON.stringify({
          ok: true,
          savedAt: nowIso,
          message: 'Draft saved! You can safely close this page and return later.'
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4g-0. Admin 1-Click Cloud AI Oil Painting & Google Photos Applier (POST /api/admin/generate-ai-art)
    if (url.pathname === '/api/admin/generate-ai-art' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: corsHeaders });
        }
        const cid = String(body.cid || '').trim();
        const reqSlug = slugifyName(body.slug || cid);
        const mode = String(body.mode || 'ai_oil_painting').trim();
        const customPrompt = String(body.customPrompt || '').trim();
        if (!cid && !reqSlug) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing cid or slug' }), { status: 400, headers: corsHeaders });
        }

        let clientRecord = null;
        const dbArt = getD1(env);
        if (dbArt) {
          await ensureD1Schema(env);
          let aRow = await dbArt.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(cid).first().catch(() => null);
          if (!aRow && reqSlug) {
            aRow = await dbArt.prepare('SELECT * FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(reqSlug).first().catch(() => null);
          }
          if (aRow) {
            let aMeta = {};
            try { aMeta = JSON.parse(aRow.metadata_json || '{}'); } catch (_) {}
            clientRecord = {
              ...aMeta,
              id: aRow.id,
              businessName: aRow.business_name || aMeta.businessName || aRow.name,
              demoSlug: aRow.demo_slug || aMeta.demoSlug || slugifyName(aRow.business_name || aRow.name || '')
            };
          }
        }
        if (cfg.stripeSecretKey) {
          const sRec = await findCustomerBySlugOrId(cid, cfg.stripeSecretKey).catch(() => null);
          if (sRec) clientRecord = { ...(clientRecord || {}), ...sRec };
        }
        if (!clientRecord) {
          return new Response(JSON.stringify({ ok: false, error: 'Client not found' }), { status: 404, headers: corsHeaders });
        }

        const cleanSlug = slugifyName(clientRecord.demoSlug || clientRecord.businessName || '');
        if (!cleanSlug || !env || !env.WYNN_KV) {
          return new Response(JSON.stringify({ ok: false, error: 'Demo slug or KV unavailable' }), { status: 400, headers: corsHeaders });
        }

        const currentHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.html`, 'text').catch(() => null);
        if (!currentHtml) {
          return new Response(JSON.stringify({ ok: false, error: 'Chưa có file HTML Demo trong KV cho tiệm này.' }), { status: 404, headers: corsHeaders });
        }

        const { config, menu } = parseConfigAndMenuFromHtml(currentHtml);
        if (!config) {
          return new Response(JSON.stringify({ ok: false, error: 'Không đọc được ATELIER_CONFIG từ bản Demo.' }), { status: 400, headers: corsHeaders });
        }

        const activePal = ['01', '02', '03', '04', '05'].includes(String(config.palette || clientRecord.demoPalette))
          ? String(config.palette || clientRecord.demoPalette)
          : '01';
        const vaultBase = 'https://wynnpages.com.au/assets/atelier/nails';
        const vaultMap = {
          '01': { hero: `${vaultBase}/hero-sanctuary.jpg`, beforeNail: `${vaultBase}/before-natural-nails.jpg`, afterNail: `${vaultBase}/biab-artistry.jpg`, biab: `${vaultBase}/biab-artistry.jpg`, pedi: `${vaultBase}/botanical-pedicure.jpg`, lookbook: [`${vaultBase}/lookbook-gilded-french.jpg`, `${vaultBase}/lookbook-pearl-glaze.jpg`, `${vaultBase}/lookbook-velvet-rose.jpg`, `${vaultBase}/lookbook-bare-cashmere.jpg`] },
          '02': { hero: `${vaultBase}/p02/hero.jpg`, beforeNail: `${vaultBase}/before-natural-nails.jpg`, afterNail: `${vaultBase}/biab-artistry.jpg`, biab: `${vaultBase}/p02/biab.jpg`, pedi: `${vaultBase}/p02/pedicure.jpg`, lookbook: [`${vaultBase}/p02/lookbook-1.jpg`, `${vaultBase}/p02/lookbook-2.jpg`, `${vaultBase}/lookbook-velvet-rose.jpg`, `${vaultBase}/lookbook-bare-cashmere.jpg`] },
          '03': { hero: `${vaultBase}/p03/hero.jpg`, beforeNail: `${vaultBase}/before-natural-nails.jpg`, afterNail: `${vaultBase}/biab-artistry.jpg`, biab: `${vaultBase}/p03/biab.jpg`, pedi: `${vaultBase}/p03/pedicure.jpg`, lookbook: [`${vaultBase}/lookbook-velvet-rose.jpg`, `${vaultBase}/p03/lookbook-1.jpg`, `${vaultBase}/p03/lookbook-2.jpg`, `${vaultBase}/lookbook-bare-cashmere.jpg`] },
          '04': { hero: `${vaultBase}/p04/hero.jpg`, beforeNail: `${vaultBase}/before-natural-nails.jpg`, afterNail: `${vaultBase}/biab-artistry.jpg`, biab: `${vaultBase}/p04/biab.jpg`, pedi: `${vaultBase}/p04/pedicure.jpg`, lookbook: [`${vaultBase}/p04/lookbook-1.jpg`, `${vaultBase}/lookbook-velvet-rose.jpg`, `${vaultBase}/p04/lookbook-2.jpg`, `${vaultBase}/lookbook-bare-cashmere.jpg`] },
          '05': { hero: `${vaultBase}/p05/hero.jpg`, beforeNail: `${vaultBase}/before-natural-nails.jpg`, afterNail: `${vaultBase}/biab-artistry.jpg`, biab: `${vaultBase}/p05/biab.jpg`, pedi: `${vaultBase}/p05/pedicure.jpg`, lookbook: [`${vaultBase}/p05/lookbook-1.jpg`, `${vaultBase}/lookbook-velvet-rose.jpg`, `${vaultBase}/p05/lookbook-2.jpg`, `${vaultBase}/lookbook-bare-cashmere.jpg`] }
        };
        const pv = vaultMap[activePal] || vaultMap['01'];
        const photosList = Array.isArray(clientRecord.placesPhotos) && clientRecord.placesPhotos.length
          ? clientRecord.placesPhotos
          : (Array.isArray(body.photos) ? body.photos : []);

        await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.pre-ai-backup.html`, currentHtml).catch(() => {});
        if (mode === 'restore_vault') {
          config.images = config.images || {};
          config.images.hero = pv.hero;
          config.images.beforeNail = pv.beforeNail;
          config.images.afterNail = pv.afterNail;
          config.images.biabFeature = pv.biab;
          config.images.pedicureFeature = pv.pedi;
          if (Array.isArray(config.images.lookbook)) {
            config.images.lookbook = config.images.lookbook.map((it, idx) => ({ ...it, src: pv.lookbook[idx % pv.lookbook.length] }));
          }
          const updatedHtml = updateHtmlWithConfigAndMenu(currentHtml, config, menu);
          await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, updatedHtml);
          return new Response(JSON.stringify({
            ok: true,
            mode,
            previewUrl: `https://${cleanSlug}.wynnpages.com.au`,
            summary: `Đã khôi phục bộ tranh sơn dầu mặc định (Bảng màu ${activePal})!`
          }), { status: 200, headers: corsHeaders });
        }

        if (mode === 'apply_google_photos') {
          if (!photosList.length) {
            return new Response(JSON.stringify({ ok: false, error: 'Tiệm này chưa có ảnh Google Maps được lưu trong hồ sơ.' }), { status: 400, headers: corsHeaders });
          }
          const photoUrls = photosList.slice(0, 6).map((ref) =>
            String(ref).startsWith('http') ? String(ref) : `https://wynnpages.com.au/api/places-photo?ref=${encodeURIComponent(ref)}&maxWidth=1200`
          );
          config.images = config.images || {};
          if (photoUrls[0]) config.images.hero = photoUrls[0];
          if (photoUrls[1]) config.images.biabFeature = photoUrls[1];
          if (photoUrls[2]) config.images.pedicureFeature = photoUrls[2];
          if (Array.isArray(config.images.lookbook) && config.images.lookbook.length) {
            config.images.lookbook = config.images.lookbook.map((it, idx) => ({
              ...it,
              src: photoUrls[idx % photoUrls.length]
            }));
          }
          const updatedHtml = updateHtmlWithConfigAndMenu(currentHtml, config, menu);
          await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, updatedHtml);
          return new Response(JSON.stringify({
            ok: true,
            mode,
            previewUrl: `https://${cleanSlug}.wynnpages.com.au`,
            appliedPhotos: photoUrls,
            summary: `Đã áp dụng ${photoUrls.length} ảnh thật Google Maps của tiệm lên trang Demo!`
          }), { status: 200, headers: corsHeaders });
        }

        const geminiApiKey = String(body.geminiApiKey || cfg.geminiApiKey || '').trim();
        if (!geminiApiKey) {
          return new Response(JSON.stringify({
            ok: false,
            error: 'Chưa có Gemini API Key! Hãy tạo miễn phí tại aistudio.google.com/apikey và dán vào mục ⚙️ Cấu hình API để vẽ tranh trực tiếp trên Cloud.'
          }), { status: 400, headers: corsHeaders });
        }

        const paletteLabelMap = {
          '01': 'Terracotta Gold, warm travertine cream, champagne, and 24k gold leaf',
          '02': 'Rose Silk, soft camellia blush, warm alabaster, and rose-gold leaf',
          '03': 'Botanical Sage, eucalyptus green, warm travertine stone, and antique brass gold leaf',
          '04': 'Espresso Cashmere, warm cedar, smoked pearl, and brushed 24k gold leaf',
          '05': 'Coastal Pearl, oyster limestone, mineral sea-glass, and champagne gold leaf'
        };
        const palDesc = paletteLabelMap[activePal] || paletteLabelMap['01'];
        const bizLabel = config.salonName || clientRecord.businessName || 'Australian Nail Sanctuary';

        let refPhotoBase64 = '';
        let refPhotoMime = 'image/jpeg';
        if (photosList[0] && cfg.googlePlacesApiKey) {
          try {
            const cleanRef = String(photosList[0]).replace(/^\/+/, '');
            const gUrl = String(photosList[0]).startsWith('http')
              ? String(photosList[0])
              : `https://places.googleapis.com/v1/${cleanRef}/media?maxWidthPx=800&maxHeightPx=800&key=${cfg.googlePlacesApiKey}`;
            const pRes = await fetch(gUrl, { redirect: 'follow' });
            if (pRes.ok) {
              refPhotoMime = pRes.headers.get('content-type') || 'image/jpeg';
              const buf = await pRes.arrayBuffer();
              if (buf && buf.byteLength > 0) {
                refPhotoBase64 = arrayBufferToBase64(buf);
              }
            }
          } catch (_) {}
        }

        const artPrompt = customPrompt || `Transform this luxury Australian nail & beauty sanctuary ("${bizLabel}") into a museum-grade French Impressionist oil painting on fine woven linen canvas with visible impasto brushstrokes and delicate 24k Kintsugi gold-leaf accents. Color palette: ${palDesc}. Sunlit serene architectural interior, unhurried quiet luxury atmosphere, zero text or watermarks.`;
        let generatedBase64 = '';
        let generatedMime = 'image/png';
        let usedModel = '';
        let lastApiError = '';

        const imgGenModels = ['gemini-2.0-flash-preview-image-generation', 'gemini-2.0-flash-exp-image-generation'];
        for (const mName of imgGenModels) {
          const reqParts = [];
          if (refPhotoBase64) {
            reqParts.push({ inline_data: { mime_type: refPhotoMime, data: refPhotoBase64 } });
          }
          reqParts.push({ text: artPrompt });

          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: reqParts }],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE']
              }
            })
          }).catch(() => null);

          if (gRes && gRes.ok) {
            const gJson = await gRes.json().catch(() => null);
            const cParts = gJson?.candidates?.[0]?.content?.parts || [];
            const imgPart = cParts.find((p) => p && (p.inlineData || p.inline_data));
            const inlineObj = imgPart && (imgPart.inlineData || imgPart.inline_data);
            if (inlineObj && inlineObj.data) {
              generatedBase64 = inlineObj.data;
              generatedMime = inlineObj.mimeType || inlineObj.mime_type || 'image/png';
              usedModel = mName;
              break;
            }
          } else if (gRes) {
            const eJson = await gRes.json().catch(() => null);
            lastApiError = (eJson && eJson.error && eJson.error.message) || `HTTP ${gRes.status}`;
          }
        }

        if (!generatedBase64) {
          const imRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(geminiApiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instances: [{ prompt: artPrompt }],
              parameters: { sampleCount: 1, aspectRatio: '3:4', outputOptions: { mimeType: 'image/jpeg' } }
            })
          }).catch(() => null);
          if (imRes && imRes.ok) {
            const imJson = await imRes.json().catch(() => null);
            const pred = imJson?.predictions?.[0];
            if (pred && pred.bytesBase64Encoded) {
              generatedBase64 = pred.bytesBase64Encoded;
              generatedMime = pred.mimeType || 'image/jpeg';
              usedModel = 'imagen-3.0-generate-002';
            }
          } else if (imRes && !lastApiError) {
            const eJson = await imRes.json().catch(() => null);
            lastApiError = (eJson && eJson.error && eJson.error.message) || `HTTP ${imRes.status}`;
          }
        }

        if (!generatedBase64) {
          return new Response(JSON.stringify({
            ok: false,
            error: lastApiError.includes('blocked')
              ? 'Key hiện tại bị khoá quyền gọi Gemini API (API_KEY_SERVICE_BLOCKED). Hãy tạo 1 Gemini API Key miễn phí tại aistudio.google.com/apikey và dán vào mục ⚙️ Cấu hình API!'
              : `Không tạo được tranh từ Gemini API (${lastApiError || 'Kiểm tra lại Gemini API Key tại aistudio.google.com/apikey'}).`
          }), { status: 400, headers: corsHeaders });
        }

        const ext = generatedMime.includes('png') ? 'png' : 'jpg';
        const assetPath = `/assets/ai-oil-hero.${ext}`;
        const binaryBuf = Uint8Array.from(atob(generatedBase64), (c) => c.charCodeAt(0));
        await env.WYNN_KV.put(`site_asset:${cleanSlug}:${assetPath}`, binaryBuf.buffer, {
          metadata: { mimeType: generatedMime, contentType: generatedMime }
        });

        const publicArtUrl = `https://${cleanSlug}.wynnpages.com.au${assetPath}?t=${Date.now()}`;
        config.images = config.images || {};
        config.images.hero = publicArtUrl;

        const updatedHtml = updateHtmlWithConfigAndMenu(currentHtml, config, menu);
        await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, updatedHtml);

        return new Response(JSON.stringify({
          ok: true,
          mode,
          model: usedModel,
          artworkUrl: publicArtUrl,
          previewUrl: `https://${cleanSlug}.wynnpages.com.au`,
          summary: `Đã vẽ tranh sơn dầu bằng ${usedModel}${refPhotoBase64 ? ' (dịch từ ảnh Google Maps thực tế của tiệm)' : ''} và cập nhật trực tiếp lên trang Demo!`
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4g. Admin 1-Click Gemini AI Auto-Editor (POST /api/admin/apply-ai-revision) & Undo (POST /api/admin/undo-ai-revision)
    if (url.pathname === '/api/admin/undo-ai-revision' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: corsHeaders });
        }
        const cid = (body.cid || '').trim();
        if (!cid) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing cid' }), { status: 400, headers: corsHeaders });
        }
        let cleanSlug = '';
        const dbU = getD1(env);
        if (dbU) {
          await ensureD1Schema(env);
          const uRow = await dbU.prepare('SELECT demo_slug, business_name FROM clients WHERE id = ? LIMIT 1').bind(cid).first().catch(() => null);
          if (uRow) cleanSlug = slugifyName(uRow.demo_slug || uRow.business_name || '');
        }
        if (!cleanSlug && cfg.stripeSecretKey) {
          const cRec = await findCustomerBySlugOrId(cid, cfg.stripeSecretKey);
          if (cRec) cleanSlug = slugifyName(cRec.demoSlug || cRec.businessName || '');
        }
        if (!cleanSlug || !env || !env.WYNN_KV) {
          return new Response(JSON.stringify({ ok: false, error: 'Client demo slug not found.' }), { status: 404, headers: corsHeaders });
        }
        const backupHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.pre-ai-backup.html`, 'text').catch(() => null);
        if (!backupHtml) {
          return new Response(JSON.stringify({ ok: false, error: 'Chưa có bản sao lưu trước khi chạy AI cho tiệm này.' }), { status: 404, headers: corsHeaders });
        }
        await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, backupHtml);
        return new Response(JSON.stringify({
          ok: true,
          message: 'Restored pre-AI backup HTML successfully!',
          previewUrl: `https://${cleanSlug}.wynnpages.com.au`
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/admin/apply-ai-revision' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ ok: false, error: auth.error }), { status: auth.status, headers: corsHeaders });
        }

        const cid = (body.cid || '').trim();
        const reqSlug = slugifyName(body.slug || cid);
        const adminInstructions = String(body.adminInstructions || '').trim();
        if (!cid && !reqSlug) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing cid' }), { status: 400, headers: corsHeaders });
        }

        // Resolve client from D1 first, then Stripe (avoiding double formatCustomerRecord)
        let clientRecord = null;
        let revData = null;
        const dbAi = getD1(env);
        if (dbAi) {
          await ensureD1Schema(env);
          let aiRow = await dbAi.prepare('SELECT * FROM clients WHERE id = ? LIMIT 1').bind(cid).first().catch(() => null);
          if (!aiRow && reqSlug) {
            aiRow = await dbAi.prepare('SELECT * FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(reqSlug).first().catch(() => null);
          }
          if (aiRow) {
            let aiMeta = {};
            try { aiMeta = JSON.parse(aiRow.metadata_json || '{}'); } catch (_) {}
            if (aiMeta && aiMeta.revisionData) revData = aiMeta.revisionData;
            clientRecord = {
              ...aiMeta,
              id: aiRow.id,
              businessName: aiRow.business_name || aiMeta.businessName || aiRow.name,
              demoSlug: aiRow.demo_slug || aiMeta.demoSlug || slugifyName(aiRow.business_name || aiRow.name || '')
            };
          }
        }
        if (cfg.stripeSecretKey) {
          const stripeRec = await findCustomerBySlugOrId(cid, cfg.stripeSecretKey).catch(() => null);
          if (stripeRec) {
            clientRecord = { ...(clientRecord || {}), ...stripeRec };
          }
        }
        if (!clientRecord) {
          return new Response(JSON.stringify({ ok: false, error: 'Customer not found' }), { status: 404, headers: corsHeaders });
        }

        const resolvedClientId = clientRecord.id || cid;
        const cleanSlug = slugifyName(clientRecord.demoSlug || clientRecord.businessName || '');

        if (!revData && env && env.WYNN_KV) {
          revData = await env.WYNN_KV.get(`revision_data:${resolvedClientId}`, 'json').catch(() => null);
        }
        if (!revData && clientRecord.metadata && clientRecord.metadata.revision_json) {
          try { revData = JSON.parse(clientRecord.metadata.revision_json); } catch (_) {}
        }
        if (!revData && !adminInstructions) {
          return new Response(JSON.stringify({ ok: false, error: 'No revision data or admin instructions found for this client.' }), { status: 400, headers: corsHeaders });
        }
        if (!revData) revData = {};

        // Read current HTML
        let currentHtml = '';
        if (env && env.WYNN_KV && cleanSlug) {
          currentHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.html`, 'text').catch(() => null);
        }
        if (!currentHtml) {
          return new Response(JSON.stringify({ ok: false, error: 'Live demo HTML not found in KV.' }), { status: 400, headers: corsHeaders });
        }

        // Read all uploaded menu pages (up to 4 pages) for Gemini Vision OCR
        let menuImagesBase64 = [];
        if (env && env.WYNN_KV) {
          const listJson = await env.WYNN_KV.get(`revision_file:${resolvedClientId}:menu_list`, 'json').catch(() => null);
          if (Array.isArray(listJson) && listJson.length > 0) {
            menuImagesBase64 = listJson.filter(Boolean);
          } else {
            const singleMenu = await env.WYNN_KV.get(`revision_file:${resolvedClientId}:menu`, 'text').catch(() => null);
            if (singleMenu) menuImagesBase64.push(singleMenu);
            for (let idx = 2; idx <= 4; idx++) {
              for (const ext of ['jpg', 'jpeg', 'png', 'pdf']) {
                const buf = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/assets/menu-revision-${idx}.${ext}`, 'arrayBuffer').catch(() => null);
                if (buf && buf.byteLength > 0) {
                  const b64 = arrayBufferToBase64(buf);
                  const mime = ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : 'image/jpeg');
                  menuImagesBase64.push(`data:${mime};base64,${b64}`);
                  break;
                }
              }
            }
          }
        }

        // Determine Gemini Key
        const geminiApiKey = (body.geminiApiKey || cfg.geminiApiKey || cfg.googlePlacesApiKey || '').trim();

        // Apply revisions to ATELIER_CONFIG & SALON_MENU_DATA
        const applyRes = await executeGeminiAutoRevision({
          currentHtml,
          revData,
          menuImageBase64: menuImagesBase64[0] || null,
          menuImagesBase64,
          adminInstructions,
          geminiApiKey
        });

        if (!applyRes.ok || !applyRes.updatedHtml) {
          return new Response(JSON.stringify({ ok: false, error: applyRes.error || 'AI revision failed' }), { status: 500, headers: corsHeaders });
        }

        // Save pre-AI backup snapshot + Save updated HTML to KV
        if (env && env.WYNN_KV && cleanSlug) {
          await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.pre-ai-backup.html`, currentHtml).catch(() => {});
          await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, applyRes.updatedHtml).catch(() => {});
        }

        // Update Stripe metadata
        const nowIso = new Date().toISOString();
        if (cfg.stripeSecretKey && resolvedClientId.startsWith('cus_')) {
          const uP = new URLSearchParams();
          uP.append('metadata[revision_status]', 'applied');
          uP.append('metadata[revision_applied_at]', nowIso);
          if (revData.bizName) uP.append('metadata[business_name]', revData.bizName.slice(0, 480));
          if (revData.phone) uP.append('metadata[display_phone]', revData.phone.slice(0, 480));
          if (revData.address) uP.append('metadata[business_address]', revData.address.slice(0, 480));

          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(resolvedClientId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          }).catch(() => {});
        }

        const finalBizName = revData.bizName || clientRecord.businessName || cleanSlug;
        const updatedClientForD1 = {
          ...clientRecord,
          id: resolvedClientId,
          businessName: finalBizName,
          displayPhone: revData.phone || clientRecord.displayPhone,
          businessAddress: revData.address || clientRecord.businessAddress,
          revisionStatus: 'applied',
          revisionAppliedAt: nowIso
        };
        await upsertD1Client(env, updatedClientForD1);

        runInBg(ctx, recordActivityAndNotify({
          type: 'ai_revision_applied',
          icon: '🤖',
          title: `Gemini AI Đã Cập Nhật Website: ${finalBizName}`,
          message: `Tóm tắt thay đổi: ${applyRes.changesSummary || 'Đã cập nhật cấu hình & bảng giá.'}\n(Đã tự động lưu bản Backup trước khi sửa để hoàn tác bất cứ lúc nào).`,
          clientName: finalBizName,
          slug: cleanSlug,
          env,
          ctx
        }));

        return new Response(JSON.stringify({
          ok: true,
          message: 'AI auto-revisions applied successfully!',
          previewUrl: `https://${cleanSlug}.wynnpages.com.au`,
          changesSummary: applyRes.changesSummary || 'Updated configuration and menu items.'
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 5. AI & Admin Brief Retrieval Endpoint (GET /api/briefs)
    if (url.pathname === '/api/briefs' && request.method === 'GET') {
      const auth = verifyAdminAuth(request, env, cfg);
      if (!auth.ok) {
        return new Response(
          JSON.stringify({ error: auth.error }),
          { status: auth.status, headers: corsHeaders }
        );
      }

      if (!cfg.stripeSecretKey) {
        return new Response(JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' }), { status: 500, headers: corsHeaders });
      }

      const filterEmail = (url.searchParams.get('email') || '').trim().toLowerCase();
      const limit = url.searchParams.get('limit') || '50';

      const stripeUrl = filterEmail
        ? `https://api.stripe.com/v1/customers?email=${encodeURIComponent(filterEmail)}&limit=10`
        : `https://api.stripe.com/v1/customers?limit=${encodeURIComponent(limit)}`;

      const res = await fetch(stripeUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
      });
      const data = await res.json().catch(() => ({}));
      let rawList = Array.isArray(data.data) ? data.data.filter(c => c && !c.deleted) : [];

      // Auto-migrate any customers from legacy env.STRIPE_SECRET_KEY (e.g. sk_test_) into active cfg.stripeSecretKey (sk_live_) & D1
      const envStripeKey = String((env && env.STRIPE_SECRET_KEY) || '').trim();
      if (envStripeKey && isValidStripeSecretKey(envStripeKey) && envStripeKey !== cfg.stripeSecretKey && !filterEmail) {
        try {
          const legacyRes = await fetch('https://api.stripe.com/v1/customers?limit=100', {
            headers: { 'Authorization': `Bearer ${envStripeKey}` }
          }).catch(() => null);
          if (legacyRes && legacyRes.ok) {
            const legacyData = await legacyRes.json().catch(() => ({}));
            const legacyCustomers = Array.isArray(legacyData.data) ? legacyData.data.filter(c => c && !c.deleted) : [];
            const activeSlugs = new Set(rawList.map(c => slugifyName((c.metadata && c.metadata.demo_slug) || (c.metadata && c.metadata.business_name) || c.name || '')));
            for (const oldC of legacyCustomers) {
              const oldFormatted = formatCustomerRecord(oldC);
              const oldSlug = slugifyName(oldFormatted.demoSlug || oldFormatted.businessName || oldFormatted.name || '');
              if (oldSlug && !activeSlugs.has(oldSlug)) {
                await upsertD1Client(env, oldFormatted);
                const migrated = await ensureStripeCustomerMigrated(env, oldFormatted.id, cfg.stripeSecretKey).catch(() => null);
                if (migrated && migrated.id) {
                  rawList.push(migrated);
                  activeSlugs.add(oldSlug);
                }
              }
            }
          }
        } catch (_) {}
      }

      const clients = rawList.map(formatCustomerRecord);

      // Also merge any D1 clients that are not yet in rawList so the Admin list is never blank
      const d1FallbackIdx = await getD1ClientsIndex(env);
      const existingIds = new Set(clients.map(c => c.id));
      const existingSlugs = new Set(clients.map(c => slugifyName(c.demoSlug || c.businessName || c.name || '')).filter(Boolean));
      for (const r of d1FallbackIdx.rows) {
        const rSlug = slugifyName(r.demo_slug || r.business_name || r.name || '');
        if (!existingIds.has(r.id) && (!rSlug || !existingSlugs.has(rSlug))) {
          let parsedMeta = {};
          try { parsedMeta = JSON.parse(r.metadata_json || '{}'); } catch (_) {}
          clients.push({
            ...parsedMeta,
            id: r.id,
            email: r.email || parsedMeta.email || '',
            name: r.name || parsedMeta.name || '',
            businessName: r.business_name || parsedMeta.businessName || '',
            phone: r.phone || parsedMeta.phone || '',
            demoSlug: r.demo_slug || parsedMeta.demoSlug || '',
            demoUrl: r.demo_url || parsedMeta.demoUrl || '',
            liveUrl: r.live_url || parsedMeta.liveUrl || '',
            stage: r.stage || parsedMeta.stage || 'outbound_pitched',
            paymentStatus: r.payment_status || parsedMeta.paymentStatus || 'unpaid',
            flowType: r.flow_type || parsedMeta.flowType || 'outbound'
          });
        }
      }

      // Real-time Stripe Checkout Session & Charge Auto-Reconciliation
      // If a client completed checkout (e.g. on live demo link), auto-sync their status to 'paid'
      try {
        const unpaidClients = clients.filter(c => c.paymentStatus === 'unpaid');
        if (unpaidClients.length > 0 && cfg.stripeSecretKey) {
          const sessionsRes = await fetch('https://api.stripe.com/v1/checkout/sessions?limit=30', {
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          }).catch(() => null);
          if (sessionsRes && sessionsRes.ok) {
            const sessData = await sessionsRes.json().catch(() => ({}));
            const paidSessions = (sessData.data || []).filter(s => s.payment_status === 'paid' || s.status === 'complete');

            for (const c of unpaidClients) {
              const matchedSession = paidSessions.find(s => {
                const sCust = typeof s.customer === 'string' ? s.customer : '';
                const sMetaCust = s.metadata && (s.metadata.customer_id || s.metadata.cid);
                const sEmail = (s.customer_details && s.customer_details.email) || s.customer_email || (s.metadata && s.metadata.customer_email);
                return (sCust && sCust.toLowerCase() === c.id.toLowerCase()) ||
                       (sMetaCust && sMetaCust.toLowerCase() === c.id.toLowerCase()) ||
                       (!sCust && !sMetaCust && c.email && sEmail && sEmail.toLowerCase() === c.email.toLowerCase());
              });

              if (matchedSession) {
                const sessPhone = (matchedSession.customer_details && matchedSession.customer_details.phone) || '';
                c.paymentStatus = 'paid';
                c.stage = c.flowType === 'outbound' ? 'outbound_paid' : (c.stage === 'checkout_started' ? 'paid' : c.stage);
                c.checkoutSessionId = matchedSession.id;
                if (sessPhone && !c.phone) {
                  c.phone = sessPhone;
                  if (!c.displayPhone) c.displayPhone = sessPhone;
                }

                const healP = new URLSearchParams();
                healP.append('metadata[payment_status]', 'paid');
                healP.append('metadata[stage]', c.stage);
                healP.append('metadata[checkout_session_id]', matchedSession.id);
                if (sessPhone) {
                  healP.append('phone', sessPhone);
                  healP.append('metadata[customer_phone]', sessPhone);
                }
                runInBg(ctx, fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(c.id)}`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: healP.toString()
                }));

                await recordActivityAndNotify({
                  type: 'payment_received',
                  title: '💰 Đã Nhận Thanh Toán $599 AUD!',
                  message: `${c.businessName || c.name} vừa thanh toán $599 AUD qua Stripe!`,
                  clientName: c.businessName || c.name,
                  slug: c.demoSlug,
                  dedupeKey: `paid_notified:${matchedSession.id}`,
                  env,
                  ctx
                });
              }
            }
          }
        }
      } catch (_) {}

      const d1ClientsIdx = await getD1ClientsIndex(env);
      const dbBriefs = getD1(env);
      const d1SmsMap = new Map();
      if (dbBriefs) {
        const smsRes = await dbBriefs.prepare(
          'SELECT id, client_id, type, to_phone, body_text, status, reason, timestamp FROM sms_history ORDER BY timestamp DESC LIMIT 500'
        ).all().catch(() => null);
        if (smsRes && Array.isArray(smsRes.results)) {
          for (const sr of smsRes.results) {
            if (!sr || !sr.client_id) continue;
            if (!d1SmsMap.has(sr.client_id)) d1SmsMap.set(sr.client_id, []);
            d1SmsMap.get(sr.client_id).push({
              id: sr.id,
              timestamp: sr.timestamp,
              type: sr.type,
              to: sr.to_phone,
              text: sr.body_text,
              status: sr.status,
              reason: sr.reason
            });
          }
        }
      }

      if (env && env.WYNN_KV) {
        await Promise.all(clients.map(async (c) => {
          const cleanSlugC = slugifyName(c.demoSlug || c.businessName || c.name || '');
          const d1Row = (c.id && d1ClientsIdx.byId.get(c.id)) || (cleanSlugC && d1ClientsIdx.bySlug.get(cleanSlugC.toLowerCase()));

          if ((!c.demoPalette || c.demoPalette === '01') && c.demoSlug) {
            const meta = await env.WYNN_KV.get(`site_meta:${c.demoSlug}`, 'json').catch(() => null);
            if (meta && meta.palette) {
              c.demoPalette = meta.palette;
            }
          }
          if (!d1Row && c.demoSlug) {
            const v = await env.WYNN_KV.get(`demo_views:${c.demoSlug}`, 'json').catch(() => null);
            if (v && v.viewCount) {
              c.demoViewCount = Math.max(c.demoViewCount || 0, Number(v.viewCount));
              if (v.claimClickCount) c.claimClickCount = Math.max(c.claimClickCount || 0, Number(v.claimClickCount));
              if (v.firstViewedAt) c.demoFirstViewedAt = v.firstViewedAt;
              if (v.lastViewedAt) c.demoLastViewedAt = v.lastViewedAt;
              if (v.lastDevice) c.demoViewerDevice = v.lastDevice;
            }
          }
          if (c.id) {
            if (c.revisionStatus && c.revisionStatus !== 'none') {
              const rData = await env.WYNN_KV.get(`revision_data:${c.id}`, 'json').catch(() => null);
              if (rData) c.revisionData = rData;
            }
            const d1Hist = d1SmsMap.get(c.id);
            if (Array.isArray(d1Hist) && d1Hist.length) {
              c.smsHistory = d1Hist.slice(0, 50).reverse();
            } else if (c.lastSmsLog) {
              const kvHist = await env.WYNN_KV.get(`sms_history:${c.id}`, 'json').catch(() => null);
              if (Array.isArray(kvHist) && kvHist.length) {
                c.smsHistory = kvHist;
              } else {
                c.smsHistory = [{
                  id: 'sms_fallback',
                  timestamp: c.submittedAt || new Date().toISOString(),
                  type: 'log',
                  to: c.phone || '',
                  text: c.lastSmsLog,
                  status: c.lastSmsLog.startsWith('OK') ? 'OK' : 'ERR',
                  reason: ''
                }];
              }
            } else {
              c.smsHistory = [];
            }
          }
        }));
      }

      for (const c of clients) {
        const cleanSlugC = slugifyName(c.demoSlug || c.businessName || c.name || '');
        const d1Row = (c.id && d1ClientsIdx.byId.get(c.id)) || (cleanSlugC && d1ClientsIdx.bySlug.get(cleanSlugC.toLowerCase()));
        if (d1Row) {
          c.demoViewCount = Math.max(Number(c.demoViewCount || 0), Number(d1Row.view_count || 0));
          c.claimClickCount = Math.max(Number(c.claimClickCount || 0), Number(d1Row.claim_click_count || 0));
          if (!c.demoLastViewedAt && d1Row.last_viewed_at) c.demoLastViewedAt = d1Row.last_viewed_at;
          if (d1Row.last_clicked_at) c.demoLastClickedAt = d1Row.last_clicked_at;
          if (!c.demoViewerDevice && d1Row.last_viewer_device) c.demoViewerDevice = d1Row.last_viewer_device;
        }
      }

      runInBg(ctx, captureAdminIp(request, env));

      return new Response(
        JSON.stringify({
          ok: true,
          count: clients.length,
          integrations: {
            stripe: Boolean(cfg.stripeSecretKey),
            clicksend: Boolean(cfg.clicksendUsername && cfg.clicksendApiKey),
            resend: Boolean(cfg.resendApiKey),
            resendFromEmail: cfg.resendFromEmail,
            googleDrive: Boolean(cfg.googleDriveWebhookUrl),
            googlePlaces: Boolean(cfg.googlePlacesApiKey),
            gemini: Boolean(cfg.geminiApiKey),
            telegram: Boolean(cfg.telegramBotToken && cfg.telegramChatId),
            cfToken: Boolean(cfg.cfApiToken)
          },
          clients
        }),
        { status: 200, headers: buildAdminHeaders(corsHeaders) }
      );
    }

    // 5b. Direct File Download / Preview Endpoint from Stripe Files API (GET /api/file?id=file_xxx&name=favicon.png&key=...)
    if (url.pathname === '/api/file' && request.method === 'GET') {
      const providedKey = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
      if (providedKey !== cfg.adminKey) {
        return new Response('Unauthorized', { status: 401 });
      }
      const fileId = (url.searchParams.get('id') || '').trim();
      const fileName = (url.searchParams.get('name') || 'download.bin').trim();
      const inline = url.searchParams.get('inline') === '1';
      if (!fileId || !fileId.startsWith('file_') || !cfg.stripeSecretKey) {
        return new Response('Missing or invalid file ID', { status: 400 });
      }
      const fileRes = await fetch(`https://files.stripe.com/v1/files/${encodeURIComponent(fileId)}/contents`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
      });
      if (!fileRes.ok) {
        return new Response('File not found on Stripe Files API', { status: 404 });
      }
      const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
      const safeName = fileName.replace(/["\r\n]/g, '_');
      return new Response(fileRes.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`
        }
      });
    }

    // 5a. Synced Studio Settings API (GET / POST /api/settings — D1 + KV synced across MacBook & iPhone PWA)
    if (url.pathname === '/api/settings' && (request.method === 'GET' || request.method === 'POST')) {
      if (request.method === 'GET') {
        const auth = verifyAdminAuth(request, env, cfg);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }
        const rt = await loadSyncedRuntime(env);
        runInBg(ctx, captureAdminIp(request, env));
        return new Response(JSON.stringify({
          ok: true,
          settings: rt.settings,
          integrations: {
            stripe: Boolean(rt.cfg.stripeSecretKey),
            stripeEnvConfigured: rt.stripeEnvConfigured,
            stripeWebhookSecret: Boolean(rt.cfg.stripeWebhookSecret),
            clicksend: Boolean(rt.cfg.clicksendUsername && rt.cfg.clicksendApiKey),
            resend: Boolean(rt.cfg.resendApiKey),
            googlePlaces: Boolean(rt.cfg.googlePlacesApiKey),
            gemini: Boolean(rt.cfg.geminiApiKey),
            telegram: Boolean(rt.cfg.telegramBotToken && rt.cfg.telegramChatId),
            cfToken: Boolean(rt.cfg.cfApiToken),
            gdrive: Boolean(rt.cfg.googleDriveWebhookUrl)
          }
        }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
      }

      const body = await request.json().catch(() => ({}));
      const postAuth = verifyAdminAuth(request, env, cfg, body);
      if (!postAuth.ok) {
        return new Response(JSON.stringify({ error: postAuth.error }), { status: postAuth.status, headers: corsHeaders });
      }
      const incoming = (body.settings && typeof body.settings === 'object') ? body.settings : body;
      const saved = await saveSyncedSettings(env, incoming, { clearEmpty: body.clearEmpty !== false });
      await captureAdminIp(request, env);
      const rt = await loadSyncedRuntime(env);
      return new Response(JSON.stringify({
        ok: true,
        settings: saved,
        integrations: {
          stripe: Boolean(rt.cfg.stripeSecretKey),
          stripeEnvConfigured: rt.stripeEnvConfigured,
          stripeWebhookSecret: Boolean(rt.cfg.stripeWebhookSecret),
          clicksend: Boolean(rt.cfg.clicksendUsername && rt.cfg.clicksendApiKey),
          resend: Boolean(rt.cfg.resendApiKey),
          googlePlaces: Boolean(rt.cfg.googlePlacesApiKey),
          gemini: Boolean(rt.cfg.geminiApiKey),
          telegram: Boolean(rt.cfg.telegramBotToken && rt.cfg.telegramChatId),
          cfToken: Boolean(rt.cfg.cfApiToken),
          gdrive: Boolean(rt.cfg.googleDriveWebhookUrl)
        }
      }), { status: 200, headers: buildAdminHeaders(corsHeaders) });
    }

    // 5b. Client Records REST API (GET/POST/PUT/DELETE /api/clients — D1 + Stripe Sync)
    if (url.pathname === '/api/clients') {
      let body = null;
      if (request.method !== 'GET') {
        body = await request.json().catch(() => ({}));
      }
      const auth = verifyAdminAuth(request, env, cfg, body);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
      }

      if (request.method === 'GET') {
        const targetId = (url.searchParams.get('id') || '').trim();
        const targetSlug = slugifyName(url.searchParams.get('slug') || '');
        const d1Idx = await getD1ClientsIndex(env);
        let clients = d1Idx.rows.map((r) => {
          let parsed = {};
          try { parsed = JSON.parse(r.metadata_json || '{}'); } catch (_) {}
          return {
            ...parsed,
            id: r.id,
            email: r.email || parsed.email || '',
            name: r.name || parsed.name || '',
            businessName: r.business_name || parsed.businessName || '',
            phone: r.phone || parsed.phone || '',
            demoSlug: r.demo_slug || parsed.demoSlug || '',
            demoUrl: r.demo_url || parsed.demoUrl || '',
            liveUrl: r.live_url || parsed.liveUrl || '',
            stage: r.stage || parsed.stage || '',
            paymentStatus: r.payment_status || parsed.paymentStatus || 'unpaid',
            flowType: r.flow_type || parsed.flowType || 'inbound',
            demoViewCount: Math.max(Number(r.view_count || 0), Number(parsed.demoViewCount || 0)),
            claimClickCount: Math.max(Number(r.claim_click_count || 0), Number(parsed.claimClickCount || 0)),
            demoLastViewedAt: r.last_viewed_at || parsed.demoLastViewedAt || '',
            demoLastClickedAt: r.last_clicked_at || parsed.demoLastClickedAt || '',
            demoViewerDevice: r.last_viewer_device || parsed.demoViewerDevice || ''
          };
        });
        if (targetId) clients = clients.filter((c) => c.id === targetId);
        if (targetSlug) clients = clients.filter((c) => slugifyName(c.demoSlug || c.businessName) === targetSlug);
        return new Response(JSON.stringify({ ok: true, count: clients.length, clients }), { status: 200, headers: corsHeaders });
      }

      if (request.method === 'POST' || request.method === 'PUT') {
        const clientId = String(body.id || body.customerId || '').trim();
        let clientRecord = null;
        if (cfg.stripeSecretKey) {
          let existingCust = null;
          if (clientId && clientId.startsWith('cus_')) {
            const gRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(clientId)}`, {
              headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
            });
            if (gRes.ok) existingCust = await gRes.json();
          }
          const uParams = new URLSearchParams();
          const bizName = (body.businessName !== undefined ? body.businessName : (existingCust?.metadata?.business_name || body.name || 'Boutique')).trim();
          const slugVal = slugifyName(body.demoSlug || existingCust?.metadata?.demo_slug || bizName) || 'demo';
          if (body.email !== undefined) uParams.append('email', String(body.email).trim());
          if (body.name !== undefined || !existingCust) uParams.append('name', String(body.name || bizName).trim());
          if (body.phone !== undefined) uParams.append('phone', String(body.phone).trim());
          uParams.append('metadata[studio]', 'WynnPages Australia');
          uParams.append('metadata[business_name]', bizName);
          uParams.append('metadata[demo_slug]', slugVal);
          uParams.append('metadata[demo_url]', (body.demoUrl || existingCust?.metadata?.demo_url || `https://${slugVal}.wynnpages.com.au`).trim());
          if (body.flowType) uParams.append('metadata[flow_type]', String(body.flowType));
          if (body.stage) uParams.append('metadata[stage]', String(body.stage));
          if (body.paymentStatus) uParams.append('metadata[payment_status]', String(body.paymentStatus));
          if (body.liveUrl !== undefined) uParams.append('metadata[live_url]', String(body.liveUrl).trim());
          const endpoint = (existingCust && existingCust.id)
            ? `https://api.stripe.com/v1/customers/${encodeURIComponent(existingCust.id)}`
            : 'https://api.stripe.com/v1/customers';
          const sRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          });
          if (sRes.ok) {
            clientRecord = formatCustomerRecord(await sRes.json());
            runInBg(ctx, ensureCloudflareSubdomain(clientRecord.demoSlug, env, cfg.cfApiToken));
          }
        }
        if (!clientRecord) {
          const slugVal = slugifyName(body.demoSlug || body.businessName || body.name || clientId || 'demo');
          clientRecord = {
            id: clientId || `local_${slugVal}`,
            email: body.email || '',
            name: body.name || body.businessName || '',
            businessName: body.businessName || body.name || '',
            phone: body.phone || '',
            demoSlug: slugVal,
            demoUrl: body.demoUrl || `https://${slugVal}.wynnpages.com.au`,
            liveUrl: body.liveUrl || '',
            stage: body.stage || 'outbound_pending',
            paymentStatus: body.paymentStatus || 'unpaid',
            flowType: body.flowType || 'outbound',
            created: Date.now()
          };
        }
        await upsertD1Client(env, clientRecord);
        runInBg(ctx, syncClientsKvSnapshot(env));
        return new Response(JSON.stringify({ ok: true, client: clientRecord }), { status: request.method === 'POST' ? 201 : 200, headers: corsHeaders });
      }

      if (request.method === 'DELETE') {
        const delId = String(body.id || url.searchParams.get('id') || '').trim();
        if (!delId) {
          return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: corsHeaders });
        }
        const db = getD1(env);
        let slugToClean = '';
        if (db) {
          await ensureD1Schema(env);
          const row = await db.prepare('SELECT demo_slug FROM clients WHERE id = ?').bind(delId).first().catch(() => null);
          if (row && row.demo_slug) slugToClean = slugifyName(row.demo_slug);
        }
        if (delId.startsWith('cus_') && cfg.stripeSecretKey) {
          runInBg(ctx, fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(delId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          }));
        }
        if (env && env.WYNN_KV && slugToClean) {
          runInBg(ctx, Promise.all([
            env.WYNN_KV.delete(`demo_views:${slugToClean}`).catch(() => {}),
            env.WYNN_KV.delete(`demo_notify_lock:${slugToClean}`).catch(() => {}),
            env.WYNN_KV.delete(`site_meta:${slugToClean}`).catch(() => {})
          ]));
        }
        await deleteD1Client(env, delId);
        return new Response(JSON.stringify({ ok: true, deletedId: delId }), { status: 200, headers: corsHeaders });
      }
    }

    // 5b-1. Public Demo Status Endpoint for claim-widget.js (GET /api/demo-status)
    if (url.pathname === '/api/demo-status' && request.method === 'GET') {
      const qCid = (url.searchParams.get('cid') || '').trim();
      const qSlug = slugifyName(url.searchParams.get('slug') || '');
      let clientObj = null;
      const db = getD1(env);
      if (db && (qCid || qSlug)) {
        await ensureD1Schema(env);
        const row = qCid
          ? await db.prepare('SELECT id, email, business_name, demo_slug, stage, payment_status, metadata_json FROM clients WHERE id = ? LIMIT 1').bind(qCid).first().catch(() => null)
          : await db.prepare('SELECT id, email, business_name, demo_slug, stage, payment_status, metadata_json FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(qSlug).first().catch(() => null);
        if (row) {
          let metaObj = {};
          try { metaObj = JSON.parse(row.metadata_json || '{}'); } catch (_) {}
          clientObj = {
            ...metaObj,
            id: row.id,
            email: row.email || metaObj.email || '',
            businessName: row.business_name || metaObj.businessName || '',
            demoSlug: row.demo_slug || metaObj.demoSlug || qSlug,
            stage: row.stage || metaObj.stage || '',
            paymentStatus: row.payment_status || metaObj.paymentStatus || 'unpaid'
          };
        }
      }
      if (!clientObj && cfg.stripeSecretKey && (qCid || qSlug)) {
        clientObj = await findCustomerBySlugOrId(qCid || qSlug, cfg.stripeSecretKey).catch(() => null);
      }
      if (!clientObj || clientObj.deleted) {
        return new Response(JSON.stringify({ ok: true, found: false, isPaid: false }), { status: 200, headers: corsHeaders });
      }
      const isPaid = clientObj.paymentStatus === 'paid' || clientObj.stage === 'outbound_paid' || clientObj.stage === 'launched' || clientObj.stage === 'site_launched';
      const isFlashDeal = !isPaid && clientObj.dealStatus === 'flash_deal' && clientObj.dealExpiresAt && new Date(clientObj.dealExpiresAt).getTime() > Date.now();
      return new Response(JSON.stringify({
        ok: true,
        found: true,
        isPaid,
        isFlashDeal,
        dealExpiresAt: clientObj.dealExpiresAt || '',
        clientId: clientObj.id || qCid,
        email: clientObj.email || '',
        businessName: clientObj.businessName || clientObj.name || '',
        slug: clientObj.demoSlug || qSlug
      }), { status: 200, headers: corsHeaders });
    }

    // 5b-2. Unified Demo View & Stripe Click Tracker (GET/POST /api/track)
    if (url.pathname === '/api/track' && (request.method === 'GET' || request.method === 'POST')) {
      let body = {};
      if (request.method === 'POST') {
        body = await request.json().catch(() => ({}));
      }
      const rawSlug = (body.slug || body.cid || url.searchParams.get('slug') || url.searchParams.get('cid') || '').trim();
      const rawCid = (body.clientId || body.cid || url.searchParams.get('cid') || '').trim();
      const rawType = String(body.eventType || body.type || url.searchParams.get('type') || 'demo_view').trim();
      const eventType = (rawType === 'self_unlock_48h' || rawType === 'unlock_demo')
        ? 'self_unlock_48h'
        : (rawType === 'claim_click' ? 'claim_click' : 'demo_view');
      const cleanSlug = slugifyName(rawSlug);
      if (!cleanSlug && !rawCid) {
        return new Response(JSON.stringify({ error: 'Missing slug or clientId' }), { status: 400, headers: corsHeaders });
      }

      // 1. Strict Bot & Crawler Filtering
      const uaRaw = request.headers.get('user-agent') || '';
      const ua = uaRaw.toLowerCase();
      if (!ua || isBotUserAgent(uaRaw)) {
        return new Response(JSON.stringify({ ok: true, ignored: 'bot' }), { status: 200, headers: corsHeaders });
      }

      // 2. Strict Admin Exclusion (Cross-subdomain cookie + ?preview=admin + recorded admin IPs) — except for explicit 48h self-unlock action
      const clientIp = getRequestClientIp(request);
      const previewFlag = (body.preview || body.admin || url.searchParams.get('preview') || url.searchParams.get('admin') || '').toString().trim();
      if (
        eventType !== 'self_unlock_48h' && (
          requestHasAdminCookie(request) ||
          previewFlag === 'admin' ||
          previewFlag === '1' ||
          body.isAdmin === true ||
          (clientIp && Array.isArray(cfg.adminIpList) && cfg.adminIpList.includes(clientIp))
        )
      ) {
        return new Response(JSON.stringify({ ok: true, ignored: 'admin' }), { status: 200, headers: corsHeaders });
      }

      // 3. Verify client exists in active DB (D1 or Stripe) and is NOT deleted or locked
      const db = getD1(env);
      let d1Client = null;
      if (db) {
        await ensureD1Schema(env);
        if (rawCid) {
          d1Client = await db.prepare('SELECT id, demo_slug, business_name, name, stage, payment_status, view_count, claim_click_count, metadata_json FROM clients WHERE id = ? LIMIT 1').bind(String(rawCid)).first().catch(() => null);
        }
        if (!d1Client && cleanSlug) {
          d1Client = await db.prepare('SELECT id, demo_slug, business_name, name, stage, payment_status, view_count, claim_click_count, metadata_json FROM clients WHERE LOWER(demo_slug) = LOWER(?) LIMIT 1').bind(cleanSlug).first().catch(() => null);
        }
      }

      let stripeClient = null;
      if (cfg.stripeSecretKey) {
        stripeClient = await findCustomerBySlugOrId(rawCid || cleanSlug, cfg.stripeSecretKey).catch(() => null);
      }

      // If client was deleted from Stripe/DB, return 404 immediately & DO NOT notify Telegram
      let d1DealStatus = '';
      if (d1Client && d1Client.metadata_json) {
        try {
          const parsedD1 = JSON.parse(d1Client.metadata_json);
          d1DealStatus = parsedD1.dealStatus || '';
        } catch (_) {}
      }
      const effectiveClient = stripeClient || (d1Client ? {
        id: d1Client.id,
        demoSlug: d1Client.demo_slug || cleanSlug,
        businessName: d1Client.business_name || d1Client.name || cleanSlug,
        name: d1Client.name || '',
        stage: d1Client.stage || '',
        paymentStatus: d1Client.payment_status || 'unpaid',
        dealStatus: d1DealStatus
      } : null);

      if (
        !effectiveClient ||
        effectiveClient.deleted ||
        effectiveClient.dealStatus === 'purged' ||
        (effectiveClient.dealStatus === 'expired' && eventType !== 'self_unlock_48h')
      ) {
        return new Response(JSON.stringify({ ok: false, error: 'Client not found or demo inactive' }), { status: 404, headers: corsHeaders });
      }

      const resolvedSlug = slugifyName(effectiveClient.demoSlug || cleanSlug);
      const device = body.device || (/iphone|ipad|ipod|android|mobile/.test(ua) ? 'Mobile' : 'Desktop');
      const ipSafe = (clientIp || 'unknown').replace(/[^a-zA-Z0-9._:-]/g, '_');

      // 3b. Handle 1-Click 48-Hour Self-Unlock from Expired Demo Screen
      if (eventType === 'self_unlock_48h') {
        const nowIso = new Date().toISOString();
        const unlockExpiresAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
        const bizName = effectiveClient.businessName || effectiveClient.name || body.businessName || resolvedSlug;

        let updatedCust = null;
        if (effectiveClient.id && String(effectiveClient.id).startsWith('cus_') && cfg.stripeSecretKey) {
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'standard');
          uP.append('metadata[deal_expires_at]', unlockExpiresAt);
          uP.append('metadata[step5_locked_at]', '');
          uP.append('metadata[nurture_step]', 'self_unlocked_48h');
          uP.append('metadata[self_unlocked_at]', nowIso);
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(effectiveClient.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          }).catch(() => null);
          if (patchRes && patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
          }
        }

          let existingD1Meta = {};
          if (d1Client && d1Client.metadata_json) {
            try { existingD1Meta = JSON.parse(d1Client.metadata_json); } catch (_) {}
          }
          const mergedClient = updatedCust || {
            ...existingD1Meta,
            ...effectiveClient,
            dealStatus: 'standard',
            dealExpiresAt: unlockExpiresAt,
            step5LockedAt: '',
            nurtureStep: 'self_unlocked_48h',
            selfUnlockedAt: nowIso
          };
          await upsertD1Client(env, mergedClient);

          if (db) {
            const rowsToUnlock = await db.prepare('SELECT id, metadata_json FROM clients WHERE id = ? OR LOWER(demo_slug) = LOWER(?)')
              .bind(String(effectiveClient.id || rawCid || ''), resolvedSlug).all().catch(() => null);
            const matchRows = (rowsToUnlock && Array.isArray(rowsToUnlock.results)) ? rowsToUnlock.results : [];
            for (const r of matchRows) {
              let metaObj = {};
              try { metaObj = JSON.parse(r.metadata_json || '{}'); } catch (_) {}
              metaObj.dealStatus = 'standard';
              metaObj.dealExpiresAt = unlockExpiresAt;
              metaObj.step5LockedAt = '';
              metaObj.nurtureStep = 'self_unlocked_48h';
              metaObj.selfUnlockedAt = nowIso;
              if (metaObj.metadata && typeof metaObj.metadata === 'object') {
                metaObj.metadata.deal_status = 'standard';
                metaObj.metadata.deal_expires_at = unlockExpiresAt;
                metaObj.metadata.step5_locked_at = '';
                metaObj.metadata.nurture_step = 'self_unlocked_48h';
              }
              await db.prepare('UPDATE clients SET metadata_json = ?, updated_at = ? WHERE id = ?')
                .bind(JSON.stringify(metaObj), nowIso, r.id).run().catch(() => {});
            }
          }

        runInBg(ctx, (async () => {
          try {
            await recordD1TrackingEvent(env, {
              slug: resolvedSlug,
              clientId: effectiveClient.id || rawCid,
              eventType: 'demo_view',
              device,
              userAgent: ua,
              businessName: bizName,
              knownClient: mergedClient
            });
            await recordActivityAndNotify({
              type: 'demo_self_unlocked',
              title: '🔓 Khách Tự Mở Khoá Demo (48 Giờ)!',
              message: `${bizName} vừa tự bấm nút Mở Khoá Xem Lại Demo 48 Giờ trên màn hình Expired (${device})! Khách đang rất quan tâm — hãy liên hệ chốt sale ngay!`,
              clientName: bizName,
              slug: resolvedSlug,
              dedupeKey: `self_unlock_lock:${resolvedSlug}:${ipSafe}`,
              dedupeTtl: 60,
              env,
              ctx
            });
            await syncClientsKvSnapshot(env);
          } catch (_) {}
        })());

        return new Response(JSON.stringify({
          ok: true,
          unlocked: true,
          dealStatus: 'standard',
          dealExpiresAt: unlockExpiresAt,
          slug: resolvedSlug,
          clientId: effectiveClient.id
        }), { status: 200, headers: corsHeaders });
      }

      // 4. Rate-limit demo_view to max 1 count + Telegram alert per unique IP per client every 6 hours (stored in D1 rate_locks — zero KV writes!)
      if (eventType === 'demo_view' && resolvedSlug) {
        const ipLockKey = `demo_view_ip_lock:${resolvedSlug}:${ipSafe}`;
        const acquired = await acquireD1RateLock(env, ipLockKey, 21600);
        if (!acquired) {
          return new Response(JSON.stringify({
            ok: true,
            ignored: 'rate_limited_6h',
            slug: resolvedSlug,
            clientId: effectiveClient.id,
            viewCount: Number((d1Client && d1Client.view_count) || effectiveClient.demoViewCount || 0)
          }), { status: 200, headers: corsHeaders });
        }
      }

      const d1Track = await recordD1TrackingEvent(env, {
        slug: resolvedSlug,
        clientId: effectiveClient.id || rawCid,
        eventType,
        device,
        userAgent: ua,
        businessName: effectiveClient.businessName || effectiveClient.name || body.businessName || '',
        knownClient: effectiveClient
      });

      if (d1Track.notFound) {
        return new Response(JSON.stringify({ ok: false, error: 'Client not found' }), { status: 404, headers: corsHeaders });
      }

      const trackBgPromise = (async () => {
        try {
          const bizName = effectiveClient.businessName || effectiveClient.name || d1Track.businessName || resolvedSlug;

          // Only mirror to KV demo_views cache if D1 binding is absent
          if (!getD1(env) && env && env.WYNN_KV && resolvedSlug) {
            const viewKey = `demo_views:${resolvedSlug}`;
            const prev = (await env.WYNN_KV.get(viewKey, 'json').catch(() => null)) || {};
            const nowIso = new Date().toISOString();
            const updatedKv = {
              ...prev,
              viewCount: Math.max(Number(prev.viewCount || 0), Number(d1Track.viewCount || 0)),
              claimClickCount: Math.max(Number(prev.claimClickCount || 0), Number(d1Track.claimClickCount || 0)),
              firstViewedAt: prev.firstViewedAt || nowIso,
              lastViewedAt: eventType === 'demo_view' ? nowIso : (prev.lastViewedAt || nowIso),
              lastClickedAt: eventType === 'claim_click' ? nowIso : (prev.lastClickedAt || ''),
              viewerDevice: device
            };
            await env.WYNN_KV.put(viewKey, JSON.stringify(updatedKv)).catch(() => {});
          }

          // Mirror counters into Stripe Customer metadata
          if (effectiveClient && effectiveClient.id && String(effectiveClient.id).startsWith('cus_') && cfg.stripeSecretKey) {
            const uP = new URLSearchParams();
            uP.append('metadata[demo_view_count]', String(d1Track.viewCount || 1));
            uP.append('metadata[claim_click_count]', String(d1Track.claimClickCount || 0));
            uP.append('metadata[demo_last_viewed_at]', d1Track.lastViewedAt || new Date().toISOString());
            uP.append('metadata[demo_viewer_device]', device);
            if (!effectiveClient.demoFirstViewedAt) {
              uP.append('metadata[demo_first_viewed_at]', d1Track.lastViewedAt || new Date().toISOString());
            }
            await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(effectiveClient.id)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: uP.toString()
            }).catch(() => {});
          }

          if (eventType === 'claim_click') {
            await recordActivityAndNotify({
              type: 'claim_clicked',
              title: '💳 Khách Bấm Nút Claim $599!',
              message: `${bizName} vừa bấm nút Claim / Mua website trên Demo (${device})!`,
              clientName: bizName,
              slug: resolvedSlug,
              dedupeKey: `claim_click_lock:${resolvedSlug}:${ipSafe}`,
              dedupeTtl: 120,
              env,
              ctx
            });
          } else {
            await recordActivityAndNotify({
              type: 'demo_viewed',
              title: '👀 Khách Đang Xem Demo!',
              message: `${bizName} vừa mở xem bản Demo của bạn! (${device})`,
              clientName: bizName,
              slug: resolvedSlug,
              dedupeKey: `demo_notify_lock:${resolvedSlug}:${ipSafe}`,
              dedupeTtl: 21600,
              env,
              ctx
            });
          }
        } catch (bgErr) {
          console.error('[track bg error]', bgErr);
        }
      })();

      runInBg(ctx, trackBgPromise);
      return new Response(JSON.stringify({
        ok: true,
        eventType,
        slug: resolvedSlug,
        clientId: d1Track.clientId,
        viewCount: d1Track.viewCount,
        claimClickCount: d1Track.claimClickCount,
        lastViewedAt: d1Track.lastViewedAt,
        lastClickedAt: d1Track.lastClickedAt
      }), { status: 200, headers: corsHeaders });
    }

    // 5b-3. Stripe Webhook Receiver (POST /api/stripe-webhook or /api/webhook)
    if ((url.pathname === '/api/stripe-webhook' || url.pathname === '/api/webhook') && request.method === 'POST') {
      const rawBody = await request.text();
      const sigHeader = request.headers.get('stripe-signature') || '';
      const event = (() => { try { return JSON.parse(rawBody); } catch (_) { return null; } })();
      if (!event || !event.type) {
        return new Response(JSON.stringify({ error: 'Invalid event payload' }), { status: 400, headers: corsHeaders });
      }

      if (cfg.stripeWebhookSecret) {
        const validSig = await verifyStripeWebhookSig(rawBody, sigHeader, cfg.stripeWebhookSecret);
        // If signature fails (e.g. stale test whsec_ after switching to sk_live_), allow checkout.session.completed to proceed only because finalizeStripePaymentAndNotify verifies the session ID directly against Stripe API using cfg.stripeSecretKey
        if (!validSig && event.type !== 'checkout.session.completed') {
          return new Response(JSON.stringify({ error: 'Invalid Stripe webhook signature' }), { status: 400, headers: corsHeaders });
        }
      }

      if (event.type === 'checkout.session.completed' && event.data && event.data.object) {
        const sessionObj = event.data.object;
        runInBg(ctx, finalizeStripePaymentAndNotify({
          sessionId: sessionObj.id,
          sessionObj: null, // Force direct verification from Stripe API via cfg.stripeSecretKey
          origin: url.origin,
          env,
          ctx,
          cfg
        }));
      }

      return new Response(JSON.stringify({ received: true, type: event.type }), { status: 200, headers: corsHeaders });
    }

    // 5b-4. Scheduled SMS Queue Management (GET/POST/DELETE /api/scheduled-sms) & Processor (/api/run-scheduled-sms)
    if (url.pathname === '/api/scheduled-sms') {
      const providedKey = request.headers.get('x-admin-key') || url.searchParams.get('key') || '';
      const db = getD1(env);
      if (request.method === 'GET') {
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }
        if (!db) return new Response(JSON.stringify({ ok: true, currentAuTime: formatAuDateTime(new Date()), items: [] }), { status: 200, headers: corsHeaders });
        await ensureD1Schema(env);
        const rowsRes = await db.prepare('SELECT * FROM scheduled_sms ORDER BY scheduled_for_utc ASC LIMIT 100').all().catch(() => null);
        return new Response(JSON.stringify({
          ok: true,
          timezone: AU_TIMEZONE,
          currentAuTime: formatAuDateTime(new Date()),
          items: (rowsRes && rowsRes.results) || []
        }), { status: 200, headers: corsHeaders });
      }

      const body = await request.json().catch(() => ({}));
      if ((body.adminKey || providedKey) !== cfg.adminKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      if (!db) return new Response(JSON.stringify({ error: 'D1 database missing' }), { status: 500, headers: corsHeaders });
      await ensureD1Schema(env);

      if (request.method === 'DELETE') {
        const id = String(body.id || url.searchParams.get('id') || '').trim();
        if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: corsHeaders });
        await db.prepare('DELETE FROM scheduled_sms WHERE id = ?').bind(id).run();
        return new Response(JSON.stringify({ ok: true, deletedId: id }), { status: 200, headers: corsHeaders });
      }

      if (request.method === 'POST') {
        const toPhone = String(body.toPhone || body.phone || '').trim();
        const bodyText = String(body.bodyText || body.message || '').trim();
        const wallInput = String(body.scheduledForAu || body.scheduledAt || '').trim();
        const scheduledForUtc = body.scheduledForUtc
          ? auWallTimeToUtcIso(body.scheduledForUtc)
          : (wallInput ? auWallTimeToUtcIso(wallInput, AU_TIMEZONE) : new Date().toISOString());

        if (!toPhone || !bodyText || !scheduledForUtc) {
          return new Response(JSON.stringify({ error: 'Missing toPhone, bodyText, or valid scheduledForAu time' }), { status: 400, headers: corsHeaders });
        }

        const scheduledForAu = formatAuDateTime(new Date(scheduledForUtc), AU_TIMEZONE);
        const rowId = `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await db.prepare(`
          INSERT INTO scheduled_sms (id, client_id, client_name, to_phone, body_text, scheduled_for_utc, scheduled_for_au, au_timezone, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).bind(
          rowId,
          String(body.clientId || ''),
          String(body.clientName || ''),
          normalizeAuPhone(toPhone) || toPhone,
          toGsmSafeAscii(bodyText),
          scheduledForUtc,
          scheduledForAu,
          AU_TIMEZONE,
          new Date().toISOString()
        ).run();

        return new Response(JSON.stringify({
          ok: true,
          id: rowId,
          toPhone: normalizeAuPhone(toPhone) || toPhone,
          scheduledForUtc,
          scheduledForAu,
          timezone: AU_TIMEZONE,
          status: 'pending'
        }), { status: 201, headers: corsHeaders });
      }
    }

    if (url.pathname === '/api/run-scheduled-sms' && (request.method === 'GET' || request.method === 'POST')) {
      const providedKey = request.headers.get('x-admin-key') || url.searchParams.get('key') || '';
      let bodyKey = '';
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        bodyKey = body.adminKey || '';
      }
      if ((bodyKey || providedKey) !== cfg.adminKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
      }
      const [result, autopilot] = await Promise.all([
        processDueScheduledSms(env, ctx),
        runScheduledAutopilot(env, { force: true, fromPing: true, ctx }).catch((err) => ({ ok: false, error: err.message }))
      ]);
      return new Response(JSON.stringify({
        ...result,
        autopilot,
        updatedClients: (autopilot && Array.isArray(autopilot.updatedClients)) ? autopilot.updatedClients : []
      }), { status: 200, headers: corsHeaders });
    }

    // Google Places Lead Hunter Endpoint (POST /api/admin/lead-hunter)
    if (url.pathname === '/api/admin/lead-hunter' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }

        const action = body.action || 'scan';

        // Helper: classify industry
        const classifyLeadIndustry = (rawInd, kw = '', nm = '') => {
          if (rawInd && ['nails', 'hair', 'lash_brow', 'spa', 'dining', 'other'].includes(rawInd)) {
            return rawInd;
          }
          const text = `${kw} ${nm}`.toLowerCase();
          if (/(nail|nails|manicure|pedicure|biab|acrylic|gel polish)/.test(text)) return 'nails';
          if (/(hair|barber|haircut|salon|stylist|balayage|barbershop)/.test(text)) return 'hair';
          if (/(lash|brow|eyebrow|microblading|eyelash|lamination)/.test(text)) return 'lash_brow';
          if (/(spa|massage|facial|skin care|wellness|dermal|clinic)/.test(text)) return 'spa';
          if (/(cafe|coffee|restaurant|dining|bakery|bistro|bar|food)/.test(text)) return 'dining';
          return 'other';
        };

        const getLeadIndustryLabel = (ind) => {
          switch (ind) {
            case 'nails': return '💅 Nails & Beauty';
            case 'hair': return '💇 Hair & Barber';
            case 'lash_brow': return '👁️ Lash & Brow';
            case 'spa': return '💆 Day Spa & Massage';
            case 'dining': return '☕ Cafe & Dining';
            default: return '✨ Ngành Khác';
          }
        };

        const computeLeadStats = (leadsArr = []) => {
          const stats = {
            total: leadsArr.length,
            hotNoWeb: 0,
            socialBooking: 0,
            customWeb: 0,
            imported: 0,
            unimported: 0
          };
          const industryCounts = {
            all: leadsArr.length,
            nails: 0,
            hair: 0,
            lash_brow: 0,
            spa: 0,
            dining: 0,
            other: 0
          };

          for (const l of leadsArr) {
            if (l.imported) stats.imported++;
            else stats.unimported++;

            if (l.leadType === 'hot_lead_no_web') stats.hotNoWeb++;
            else if (l.leadType === 'social_booking_only') stats.socialBooking++;
            else stats.customWeb++;

            const ind = l.industry || 'other';
            if (industryCounts[ind] !== undefined) {
              industryCounts[ind]++;
            } else {
              industryCounts.other++;
            }
          }
          return { stats, industryCounts };
        };

        const sortLeads = (arr) => {
          return arr.sort((a, b) => {
            // Unimported first
            if (Boolean(a.imported) !== Boolean(b.imported)) {
              return a.imported ? 1 : -1;
            }
            // Higher priority score first (Hot Lead 3 -> Social 2 -> Custom Web 1)
            if ((b.priorityScore || 0) !== (a.priorityScore || 0)) {
              return (b.priorityScore || 0) - (a.priorityScore || 0);
            }
            // Higher review count first
            if ((b.userRatingCount || 0) !== (a.userRatingCount || 0)) {
              return (b.userRatingCount || 0) - (a.userRatingCount || 0);
            }
            return (b.rating || 0) - (a.rating || 0);
          });
        };

        // Load existing stored leads from D1 (primary) or KV (fallback)
        let storedLeads = [];
        const dbLh = getD1(env);
        if (dbLh) {
          await ensureD1Schema(env);
          const d1Res = await dbLh.prepare('SELECT data_json, imported FROM lead_hunter_leads ORDER BY updated_at DESC LIMIT 500').all().catch(() => null);
          if (d1Res && Array.isArray(d1Res.results) && d1Res.results.length > 0) {
            storedLeads = d1Res.results.map(r => {
              try {
                const parsed = JSON.parse(r.data_json || '{}');
                if (r.imported) parsed.imported = true;
                return parsed;
              } catch (_) { return null; }
            }).filter(Boolean);
          }
        }
        if (storedLeads.length === 0 && env && env.WYNN_KV) {
          const rawKv = await env.WYNN_KV.get('studio_lead_hunter_db', 'json').catch(() => null);
          if (Array.isArray(rawKv)) {
            storedLeads = rawKv;
            if (dbLh && storedLeads.length > 0) {
              runInBg(ctx, mirrorLeadHunterToD1(env, storedLeads));
            }
          }
        }

        const persistLeads = async (leadsToSave) => {
          if (dbLh) {
            await mirrorLeadHunterToD1(env, leadsToSave);
          } else if (env && env.WYNN_KV) {
            await env.WYNN_KV.put('studio_lead_hunter_db', JSON.stringify(leadsToSave)).catch(() => {});
          }
        };

        // ACTION 1: LIST STORED LEADS (Immediate cached read)
        if (action === 'list') {
          const sorted = sortLeads([...storedLeads]);
          const { stats, industryCounts } = computeLeadStats(sorted);
          return new Response(
            JSON.stringify({
              ok: true,
              totalLeads: sorted.length,
              leads: sorted,
              stats,
              industryCounts
            }),
            { status: 200, headers: corsHeaders }
          );
        }

        // ACTION 2: MARK IMPORTED
        if (action === 'mark_imported') {
          const targetId = body.placeId || body.id;
          let found = false;
          let updatedLead = null;

          storedLeads = storedLeads.map((l) => {
            if ((l.placeId && l.placeId === targetId) || (l.id && l.id === targetId)) {
              found = true;
              updatedLead = {
                ...l,
                imported: true,
                importedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              return updatedLead;
            }
            return l;
          });

          if (found) {
            await persistLeads(storedLeads);
          }

          const { stats, industryCounts } = computeLeadStats(storedLeads);
          return new Response(
            JSON.stringify({
              ok: true,
              found,
              lead: updatedLead,
              totalLeads: storedLeads.length,
              stats,
              industryCounts
            }),
            { status: 200, headers: corsHeaders }
          );
        }

        // ACTION 3: DELETE LEAD
        if (action === 'delete_lead') {
          const targetId = body.placeId || body.id;
          const initialLen = storedLeads.length;
          storedLeads = storedLeads.filter((l) => !(l.placeId === targetId || l.id === targetId));

          if (storedLeads.length !== initialLen) {
            await persistLeads(storedLeads);
          }

          const { stats, industryCounts } = computeLeadStats(storedLeads);
          return new Response(
            JSON.stringify({
              ok: true,
              deleted: storedLeads.length !== initialLen,
              totalLeads: storedLeads.length,
              stats,
              industryCounts
            }),
            { status: 200, headers: corsHeaders }
          );
        }

        // ACTION 4: CLEAR LEADS (Per industry or all)
        if (action === 'clear_leads') {
          const indFilter = body.industry || 'all';
          if (indFilter === 'all') {
            storedLeads = [];
          } else {
            storedLeads = storedLeads.filter((l) => (l.industry || 'other') !== indFilter);
          }
          await persistLeads(storedLeads);
          const { stats, industryCounts } = computeLeadStats(storedLeads);
          return new Response(
            JSON.stringify({
              ok: true,
              clearedIndustry: indFilter,
              totalLeads: storedLeads.length,
              stats,
              industryCounts
            }),
            { status: 200, headers: corsHeaders }
          );
        }

        // ACTION 5: SCAN GOOGLE MAPS AND ACCUMULATE (DEFAULT)
        const effectivePlacesKey = (body.googlePlacesApiKey || cfg.googlePlacesApiKey || '').trim();
        if (!effectivePlacesKey) {
          return new Response(
            JSON.stringify({
              ok: false,
              missingKey: true,
              error: 'Chưa cấu hình Google Places API Key. Vui lòng bấm vào "Cài đặt Key ⚙️" và nhập key.'
            }),
            { status: 400, headers: corsHeaders }
          );
        }

        const keyword = (body.keyword || 'Nail Salon').trim();
        const location = (body.location || 'Brisbane QLD').trim();
        const rawSelectedIndustry = (body.industry || '').trim();
        const minRating = parseFloat(body.minRating) || 0;
        const textQuery = `${keyword} in ${location}`;

        // Call Google Places API (New): places.googleapis.com/v1/places:searchText
        const fieldMask = [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.rating',
          'places.userRatingCount',
          'places.websiteUri',
          'places.googleMapsUri',
          'places.regularOpeningHours',
          'places.reviews',
          'places.photos',
          'places.parkingOptions',
          'places.editorialSummary'
        ].join(',');

        const gRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': effectivePlacesKey,
            'X-Goog-FieldMask': fieldMask
          },
          body: JSON.stringify({
            textQuery,
            maxResultCount: 20
          })
        });

        let rawPlaces = [];
        if (gRes.ok) {
          const gData = await gRes.json();
          rawPlaces = Array.isArray(gData.places) ? gData.places : [];
        } else {
          const gErr = await gRes.json().catch(() => ({}));
          const errMsg = gErr.error?.message || `Google Places API HTTP ${gRes.status}`;

          // Try smart fallback to legacy Places API if Places API (New) is not enabled on project
          let legacySucceeded = false;
          try {
            const legRes = await fetch(
              `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(textQuery)}&key=${encodeURIComponent(effectivePlacesKey)}`
            );
            const legData = await legRes.json().catch(() => ({}));
            if (legRes.ok && legData.status === 'OK' && Array.isArray(legData.results) && legData.results.length > 0) {
              legacySucceeded = true;
              rawPlaces = legData.results.slice(0, 20).map((r) => ({
                id: r.place_id,
                displayName: { text: r.name },
                formattedAddress: r.formatted_address,
                rating: r.rating || 0,
                userRatingCount: r.user_ratings_total || 0,
                websiteUri: '',
                nationalPhoneNumber: '',
                regularOpeningHours: { weekdayDescriptions: [] },
                reviews: []
              }));

              // Enrich top 10 with Place Details (website, phone, hours, reviews)
              const enrichPromises = rawPlaces.slice(0, 10).map(async (p) => {
                try {
                  const dRes = await fetch(
                    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.id}&fields=name,formatted_phone_number,international_phone_number,website,opening_hours,reviews&key=${encodeURIComponent(effectivePlacesKey)}`
                  );
                  const dData = await dRes.json().catch(() => ({}));
                  if (dData.result) {
                    p.nationalPhoneNumber = dData.result.formatted_phone_number || dData.result.international_phone_number || '';
                    p.websiteUri = dData.result.website || '';
                    if (dData.result.opening_hours?.weekday_text) {
                      p.regularOpeningHours.weekdayDescriptions = dData.result.opening_hours.weekday_text;
                    }
                    if (Array.isArray(dData.result.reviews)) {
                      p.reviews = dData.result.reviews.map((rv) => ({
                        authorAttribution: { displayName: rv.author_name },
                        rating: rv.rating,
                        text: { text: rv.text }
                      }));
                    }
                  }
                } catch (_) {}
              });
              await Promise.all(enrichPromises);
            }
          } catch (_) {}

          if (!legacySucceeded) {
            const isPermissionDenied = errMsg.toLowerCase().includes('permission denied');
            let friendlyMsg = errMsg;
            if (isPermissionDenied) {
              friendlyMsg = 'Google từ chối quyền (Permission denied): Vui lòng vào Google Cloud Console BẬT "Places API (New)" và kiểm tra API Key không bị giới hạn (Restrictions: None).';
            }
            return new Response(
              JSON.stringify({
                ok: false,
                error: friendlyMsg,
                isPermissionDenied,
                details: gErr,
                enableUrl: 'https://console.cloud.google.com/apis/library/places.googleapis.com',
                credentialsUrl: 'https://console.cloud.google.com/apis/credentials'
              }),
              { status: 403, headers: corsHeaders }
            );
          }
        }

        // Classify & Process Leads
        const socialRegex = /(facebook\.com|instagram\.com|linktr\.ee|fresha\.com|timely\.com|square\.site|booksy\.com|heygoldie\.com|vagaro\.com|tiktok\.com|ovatu\.com|appointfix\.com|glossgenius\.com)/i;

        const newProcessed = rawPlaces.map((p) => {
          const name = p.displayName?.text || p.name || '';
          const address = p.formattedAddress || '';
          const phone = p.nationalPhoneNumber || p.internationalPhoneNumber || '';
          const rating = typeof p.rating === 'number' ? p.rating : 0;
          const userRatingCount = typeof p.userRatingCount === 'number' ? p.userRatingCount : 0;
          const website = (p.websiteUri || '').trim();

          // Top 3 Five-Star Reviews
          const rawReviews = Array.isArray(p.reviews) ? p.reviews : [];
          const topReviews = rawReviews
            .filter((r) => (r.rating || 0) >= 4)
            .slice(0, 3)
            .map((r) => ({
              author: r.authorAttribution?.displayName || 'Local Regular',
              rating: r.rating || 5,
              text: (r.text?.text || r.text || '').trim().slice(0, 280)
            }));

          // Opening Hours
          const weekdayDescriptions = Array.isArray(p.regularOpeningHours?.weekdayDescriptions)
            ? p.regularOpeningHours.weekdayDescriptions
            : [];

          // Real Client Photos (Places API New)
          const rawPhotos = Array.isArray(p.photos) ? p.photos : [];
          const photos = rawPhotos.slice(0, 8).map((ph) => ph.name);

          // Parking Info
          let parkingInfo = '';
          if (p.parkingOptions) {
            const opts = [];
            if (p.parkingOptions.freeParkingLot) opts.push('Free parking lot');
            if (p.parkingOptions.freeStreetParking) opts.push('Free street parking');
            if (p.parkingOptions.paidParkingLot) opts.push('Paid parking lot');
            if (p.parkingOptions.paidStreetParking) opts.push('Paid street parking');
            if (p.parkingOptions.valetParking) opts.push('Valet parking');
            parkingInfo = opts.join(', ');
          }

          // Editorial Summary
          const editorialSummary = (p.editorialSummary?.text || p.editorialSummary || '').trim();

          // Classification
          let leadType = 'custom_web';
          let statusBadge = '⚪ Đã có Web riêng';
          let priorityScore = 1;
          let bookingOrSocialLink = '';
          let instagram = '';
          let facebook = '';
          let email = '';

          if (!website) {
            leadType = 'hot_lead_no_web';
            statusBadge = '🔴 Chưa có Web (Hot Lead)';
            priorityScore = 3;
          } else if (socialRegex.test(website)) {
            leadType = 'social_booking_only';
            statusBadge = '🟡 Chỉ dùng MXH / Link Booking';
            priorityScore = 2;
            bookingOrSocialLink = website;
            if (/instagram\.com/i.test(website)) instagram = website;
            if (/facebook\.com/i.test(website)) facebook = website;
          }

          // Extract Australian Suburb / State from address
          let suburb = '';
          const auMatch = address.match(/([A-Z\s]+)\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})/i);
          if (auMatch) {
            suburb = `${auMatch[1].trim()}, ${auMatch[2].toUpperCase()} ${auMatch[3]}`;
          }

          const industry = classifyLeadIndustry(rawSelectedIndustry, keyword, name);
          const industryLabel = getLeadIndustryLabel(industry);
          const googleMapsUri = p.googleMapsUri || (p.id ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${encodeURIComponent(p.id)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`);

          return {
            id: p.id || ('lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
            placeId: p.id || '',
            name,
            phone,
            address,
            suburb,
            rating,
            userRatingCount,
            website,
            googleMapsUri,
            leadType,
            statusBadge,
            priorityScore,
            bookingOrSocialLink,
            openingHours: weekdayDescriptions,
            topReviews,
            photos,
            parkingInfo,
            editorialSummary,
            instagram,
            facebook,
            email,
            industry,
            industryLabel,
            imported: false,
            scannedKeyword: keyword,
            scannedLocation: location
          };
        });

        // Enrich custom websites concurrently with social & contact scraping
        const enrichPromises = newProcessed.map(async (lead) => {
          if (lead.website && !socialRegex.test(lead.website)) {
            try {
              const scraped = await extractSocialAndContactFromWebsite(lead.website);
              if (scraped.instagram && !lead.instagram) lead.instagram = scraped.instagram;
              if (scraped.facebook && !lead.facebook) lead.facebook = scraped.facebook;
              if (scraped.email && !lead.email) lead.email = scraped.email;
              if (scraped.booking && !lead.bookingOrSocialLink) lead.bookingOrSocialLink = scraped.booking;
            } catch (_) {}
          }
        });
        await Promise.allSettled(enrichPromises);

        // Filter by min rating
        const filteredNew = minRating > 0
          ? newProcessed.filter((item) => item.rating >= minRating)
          : newProcessed;

        // CUMULATIVE MERGE & DEDUPLICATION WITH KV
        const leadMap = new Map();
        // 1. Seed with existing stored leads
        for (const item of storedLeads) {
          const key = item.placeId || `${(item.name || '').toLowerCase().trim()}||${(item.suburb || item.address || '').toLowerCase().trim()}`;
          leadMap.set(key, item);
        }

        let addedCount = 0;
        let updatedCount = 0;
        const nowIso = new Date().toISOString();

        // 2. Merge newly scanned leads
        for (const shop of filteredNew) {
          const key = shop.placeId || `${(shop.name || '').toLowerCase().trim()}||${(shop.suburb || shop.address || '').toLowerCase().trim()}`;
          if (leadMap.has(key)) {
            const existing = leadMap.get(key);
            // Preserve imported state and original creation timestamp
            leadMap.set(key, {
              ...existing,
              rating: shop.rating || existing.rating,
              userRatingCount: shop.userRatingCount || existing.userRatingCount,
              topReviews: (shop.topReviews && shop.topReviews.length) ? shop.topReviews : existing.topReviews,
              openingHours: (shop.openingHours && shop.openingHours.length) ? shop.openingHours : existing.openingHours,
              phone: shop.phone || existing.phone,
              website: shop.website || existing.website,
              leadType: shop.leadType || existing.leadType,
              statusBadge: shop.statusBadge || existing.statusBadge,
              priorityScore: shop.priorityScore || existing.priorityScore,
              bookingOrSocialLink: shop.bookingOrSocialLink || existing.bookingOrSocialLink,
              photos: (shop.photos && shop.photos.length) ? shop.photos : (existing.photos || []),
              parkingInfo: shop.parkingInfo || existing.parkingInfo || '',
              editorialSummary: shop.editorialSummary || existing.editorialSummary || '',
              instagram: shop.instagram || existing.instagram || '',
              facebook: shop.facebook || existing.facebook || '',
              email: shop.email || existing.email || '',
              industry: existing.industry || shop.industry,
              industryLabel: existing.industryLabel || shop.industryLabel,
              updatedAt: nowIso
            });
            updatedCount++;
          } else {
            leadMap.set(key, {
              ...shop,
              createdAt: nowIso,
              updatedAt: nowIso
            });
            addedCount++;
          }
        }

        const mergedLeads = sortLeads(Array.from(leadMap.values()));

        // Save cumulative database to D1 (primary) or KV (fallback)
        await persistLeads(mergedLeads);

        const { stats, industryCounts } = computeLeadStats(mergedLeads);

        return new Response(
          JSON.stringify({
            ok: true,
            query: { keyword, location, minRating, industry: rawSelectedIndustry },
            scannedThisBatch: filteredNew.length,
            addedCount,
            updatedCount,
            totalLeads: mergedLeads.length,
            leads: mergedLeads,
            stats,
            industryCounts
          }),
          { status: 200, headers: corsHeaders }
        );
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 6. Admin Command Center Action Endpoint (POST /api/admin/action)
    if (url.pathname === '/api/admin/action' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }

        if (body.credentials && typeof body.credentials === 'object') {
          await saveSyncedSettings(env, body.credentials);
          Object.assign(runtimeCreds, body.credentials);
        }
        const effectiveCfg = getConfig(env, { ...runtimeCreds, ...(body.credentials || {}) });
        const action = body.action || '';
        let customerId = (body.customerId || '').trim();
        if (customerId && action !== 'delete_client' && effectiveCfg.stripeSecretKey) {
          const migratedCust = await ensureStripeCustomerMigrated(env, customerId, effectiveCfg.stripeSecretKey).catch(() => null);
          if (migratedCust && migratedCust.id) {
            customerId = migratedCust.id;
          }
        }

        // Action 0: Delete Client Record
        if (action === 'save_cf_token') {
          await saveSyncedSettings(env, { cfApiToken: (body.cfToken || '').trim() }, { clearEmpty: true });
          return new Response(JSON.stringify({ ok: true, message: 'Cloudflare API Token updated' }), { status: 200, headers: corsHeaders });
        }

        if (action === 'delete_client' && customerId) {
          let slugToClean = (body.slug || '').trim();
          let liveUrlToClean = (body.liveUrl || '').trim();
          let phoneToClean = '';
          const dbDel = getD1(env);
          if (dbDel) {
            await ensureD1Schema(env);
            const d1Row = await dbDel.prepare('SELECT demo_slug, live_url, phone FROM clients WHERE id = ? LIMIT 1').bind(customerId).first().catch(() => null);
            if (d1Row) {
              if (!slugToClean && d1Row.demo_slug) slugToClean = d1Row.demo_slug;
              if (!liveUrlToClean && d1Row.live_url) liveUrlToClean = d1Row.live_url;
              if (d1Row.phone) phoneToClean = d1Row.phone;
            }
          }
          if (!slugToClean || !liveUrlToClean) {
            try {
              const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
                headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
              });
              if (cRes.ok) {
                const cData = await cRes.json();
                if (!slugToClean) {
                  slugToClean = cData.metadata?.demo_slug || (cData.metadata?.demo_url ? extractCleanHost(cData.metadata.demo_url) : '');
                }
                if (!liveUrlToClean) {
                  liveUrlToClean = cData.metadata?.live_url || '';
                }
                if (!phoneToClean) {
                  phoneToClean = cData.phone || cData.metadata?.customer_phone || '';
                }
              }
            } catch (_) { }
          }

          // Delete primary customer record in Stripe, then completely purge KV, D1, and Worker Domains
          const delRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          const delData = await delRes.json().catch(() => ({}));

          await Promise.all([
            purgeDemoSiteAssetsFromKv(env, slugToClean, customerId).catch(() => {}),
            deleteD1Client(env, customerId, slugToClean).catch(() => {}),
            cancelPendingScheduledSmsForCustomer(env, customerId, phoneToClean).catch(() => {}),
            slugToClean ? removeCloudflareWorkerDomain(slugToClean, env, effectiveCfg.cfApiToken).catch(() => {}) : Promise.resolve(),
            liveUrlToClean ? removeCloudflareWorkerDomain(liveUrlToClean, env, effectiveCfg.cfApiToken).catch(() => {}) : Promise.resolve(),
            liveUrlToClean ? removeCloudflareWorkerDomain(`www.${liveUrlToClean}`, env, effectiveCfg.cfApiToken).catch(() => {}) : Promise.resolve(),
            (liveUrlToClean && env && env.WYNN_KV) ? env.WYNN_KV.delete(`livedom_${liveUrlToClean}`).catch(() => {}) : Promise.resolve()
          ]);
          runInBg(ctx, syncClientsKvSnapshot(env));

          return new Response(JSON.stringify({ ok: delRes.ok || true, customerId, slugPurged: slugToClean, deleted: delData }), { status: 200, headers: corsHeaders });
        }

        // Action: Toggle 10-Day Nurture Automation Per Client
        if (action === 'toggle_nurture_auto' && customerId) {
          const enabled = body.enabled !== false && body.enabled !== 'false';
          const uP = new URLSearchParams();
          uP.append('metadata[nurture_auto_enabled]', enabled ? 'true' : 'false');
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });
          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
          }
          return new Response(JSON.stringify({ ok: true, nurtureAutoEnabled: enabled, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Activate Flash Deal 50% ($299 AUD / 72h Server Synced)
        if (action === 'activate_flash_deal' && customerId) {
          const hours = parseFloat(body.hours) || 72;
          const now = Date.now();
          const dealExpiresAt = new Date(now + hours * 3600 * 1000).toISOString();
          const dealActivatedAt = new Date(now).toISOString();

          let custToNotify = null;
          const preRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (preRes.ok) custToNotify = formatCustomerRecord(await preRes.json());

          const cleanSlugCheck = slugifyName((custToNotify && (custToNotify.demoSlug || custToNotify.businessName)) || '');
          let realViews = Number((custToNotify && custToNotify.demoViewCount) || 0);
          const dbCheck = getD1(env);
          if (dbCheck) {
            await ensureD1Schema(env);
            const rowV = await dbCheck.prepare('SELECT view_count FROM clients WHERE id = ?').bind(customerId).first().catch(() => null);
            if (rowV && rowV.view_count) realViews = Math.max(realViews, Number(rowV.view_count));
          }
          if (env && env.WYNN_KV && cleanSlugCheck) {
            const kvV = await env.WYNN_KV.get(`demo_views:${cleanSlugCheck}`, 'json').catch(() => null);
            if (kvV && kvV.viewCount) realViews = Math.max(realViews, Number(kvV.viewCount));
          }

          if (realViews === 0 && body.onlyIfViewed === true) {
            let nudgeRes = null;
            let nudgeText = '';
            const biz = (custToNotify && (custToNotify.businessName || custToNotify.name)) || 'Boutique';
            const demoLink = (custToNotify && (custToNotify.demoUrl || custToNotify.brandedDemoUrl)) || (cleanSlugCheck ? `https://${cleanSlugCheck}.wynnpages.com.au` : '');
            const uP0 = new URLSearchParams();
            uP0.append('metadata[nurture_step]', 'day7_nudge_0views');
            if (body.notify && custToNotify && custToNotify.phone && effectiveCfg.clicksendApiKey) {
              nudgeText = buildNurtureStepSms({ stepKey: 'day7_nudge_0views', biz, demoUrl: demoLink, views: 0 });
              nudgeRes = await sendClickSendSms({ to: custToNotify.phone, message: nudgeText, cfg: effectiveCfg });
              if (nudgeRes) {
                const nowIso0 = new Date().toISOString();
                const logMsg0 = nudgeRes.sent
                  ? `OK (${nudgeRes.to || custToNotify.phone}) [day7_nudge_0views] @ ${nowIso0}`
                  : `ERR: ${(nudgeRes && nudgeRes.reason) || 'Failed'} [day7_nudge_0views]`;
                uP0.append('metadata[last_sms_log]', logMsg0.slice(0, 480));
                await recordSmsHistory({
                  customerId,
                  env,
                  stripeSecretKey: effectiveCfg.stripeSecretKey,
                  type: 'day7_nudge_0views',
                  to: custToNotify.phone,
                  text: nudgeText,
                  status: nudgeRes.sent,
                  reason: nudgeRes.reason
                });
              }
            }
            const patch0 = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: uP0.toString()
            });
            let updated0 = custToNotify;
            if (patch0.ok) updated0 = formatCustomerRecord(await patch0.json());
            if (updated0) await upsertD1Client(env, updated0);
            if (body.notify && nudgeRes) {
              await notifyTelegramAutomatedComms({
                env,
                ctx,
                client: updated0 || custToNotify,
                triggerType: 'nurture_day7_nudge_0views',
                icon: '👋',
                title: `👋 [NGÀY 7 - 0 VIEW] Đã gửi SMS nhắc nhẹ xem Demo: ${biz}`,
                views: realViews,
                smsSent: Boolean(nudgeRes && nudgeRes.sent),
                smsSkippedReason: nudgeRes && nudgeRes.reason,
                smsTo: (nudgeRes && nudgeRes.to) || custToNotify.phone,
                smsText: nudgeText,
                waitForTelegram: true
              });
            }
            return new Response(JSON.stringify({
              ok: true,
              skippedDealSms: true,
              reason: 'Client has 0 demo views — skipped 50% Deal SMS and sent gentle preview nudge instead.',
              client: updated0,
              notifyRes: nudgeRes
            }), { status: 200, headers: corsHeaders });
          }

          let notifyRes = null;
          let emailRes = null;
          let dealSmsText = '';
          let dealMailSubject = '';
          let logMsg = '';
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'flash_deal');
          uP.append('metadata[deal_activated_at]', dealActivatedAt);
          uP.append('metadata[deal_expires_at]', dealExpiresAt);
          uP.append('metadata[nurture_step]', 'day7_deal_active');
          uP.append('metadata[step3_sent_at]', dealActivatedAt);
          uP.append('metadata[fb_due_step]', '');

          const biz = (custToNotify && (custToNotify.businessName || custToNotify.name)) || 'Boutique';
          const demoLink = (custToNotify && (custToNotify.demoUrl || custToNotify.brandedDemoUrl)) || ( custToNotify && custToNotify.demoSlug ? `https://${custToNotify.demoSlug}.wynnpages.com.au` : `https://${customerId}.wynnpages.com.au`);

          if (body.notify && custToNotify && custToNotify.phone && effectiveCfg.clicksendApiKey) {
            dealSmsText = buildNurtureStepSms({ stepKey: 'step3', biz, demoUrl: demoLink, views: Number((custToNotify && custToNotify.views) || 0) });
            notifyRes = await sendClickSendSms({ to: custToNotify.phone, message: dealSmsText, cfg: effectiveCfg });
            if (notifyRes) {
              const nowIso = new Date().toISOString();
              logMsg = notifyRes.sent
                ? `OK (${notifyRes.to || custToNotify.phone}) [deal_50_active] @ ${nowIso}`
                : `ERR: ${(notifyRes && notifyRes.reason) || 'Failed'} [deal_50_active]`;
              uP.append('metadata[last_sms_log]', logMsg.slice(0, 480));
              await recordSmsHistory({
                customerId,
                env,
                stripeSecretKey: effectiveCfg.stripeSecretKey,
                type: 'deal_50_active',
                to: custToNotify.phone,
                text: dealSmsText,
                status: notifyRes.sent,
                reason: notifyRes.reason
              });
            }
          }
          if (body.notify && custToNotify && custToNotify.email && effectiveCfg.resendApiKey) {
            const mailPayload = buildNurtureStepEmail({ stepKey: 'step3', client: custToNotify, demoUrl: demoLink });
            if (mailPayload) {
              dealMailSubject = mailPayload.subject || '';
              emailRes = await sendResendEmail({ to: custToNotify.email, subject: mailPayload.subject, html: mailPayload.html, cfg: effectiveCfg }).catch(() => null);
              if (emailRes && emailRes.sent) {
                uP.append('metadata[last_email_log]', `OK (${custToNotify.email}) [deal_50_active] @ ${dealActivatedAt}`.slice(0, 480));
              }
            }
          }

          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
          }
          if (updatedCust && logMsg) {
            updatedCust.lastSmsLog = logMsg;
          }
          if (updatedCust) {
            await upsertD1Client(env, updatedCust);
          }

          if (body.notify && (notifyRes || emailRes)) {
            await notifyTelegramAutomatedComms({
              env,
              ctx,
              client: updatedCust || custToNotify,
              triggerType: 'nurture_flash_deal_299',
              icon: '🔥',
              title: `🔥 [DEAL 50% $299] Đã gửi SMS/Email giảm giá 72h cho ${biz}`,
              views: realViews,
              smsSent: Boolean(notifyRes && notifyRes.sent),
              smsSkippedReason: notifyRes && notifyRes.reason,
              smsTo: (notifyRes && notifyRes.to) || (custToNotify && custToNotify.phone) || '',
              smsText: dealSmsText,
              emailSent: Boolean(emailRes && emailRes.sent),
              emailSkippedReason: emailRes && emailRes.reason,
              emailTo: (custToNotify && custToNotify.email) || '',
              emailSubject: dealMailSubject,
              waitForTelegram: true
            });
          }

          return new Response(JSON.stringify({ ok: true, dealStatus: 'flash_deal', dealExpiresAt, client: updatedCust, notifyRes }), { status: 200, headers: corsHeaders });
        }

        // Action: Expire / Archive Demo Hard (HTTP 403 Locked)
        if (action === 'expire_demo' && customerId) {
          const nowIso = new Date().toISOString();
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'expired');
          uP.append('metadata[deal_expires_at]', nowIso);
          uP.append('metadata[step5_locked_at]', nowIso);
          uP.append('metadata[nurture_step]', 'demo_expired');
          uP.append('metadata[fb_due_step]', '');

          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
          }
          return new Response(JSON.stringify({ ok: true, dealStatus: 'expired', client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Restore Expired Demo to Standard
        if (action === 'restore_demo' && customerId) {
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'standard');
          uP.append('metadata[deal_expires_at]', '');
          uP.append('metadata[step5_locked_at]', '');
          uP.append('metadata[nurture_step]', 'restored');

          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
          }
          return new Response(JSON.stringify({ ok: true, dealStatus: 'standard', client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Purge Demo KV Assets & Permanent Withdraw (Day 10+ Complete Clean)
        if (action === 'purge_demo' && customerId) {
          let slugToClean = (body.slug || '').trim();
          const dbPurge = getD1(env);
          if (!slugToClean && dbPurge) {
            await ensureD1Schema(env);
            const pRow = await dbPurge.prepare('SELECT demo_slug FROM clients WHERE id = ? LIMIT 1').bind(customerId).first().catch(() => null);
            if (pRow && pRow.demo_slug) slugToClean = pRow.demo_slug;
          }
          if (!slugToClean) {
            try {
              const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
                headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
              });
              if (cRes.ok) {
                const cData = await cRes.json();
                slugToClean = cData.metadata?.demo_slug || (cData.metadata?.demo_url ? extractCleanHost(cData.metadata.demo_url) : '');
              }
            } catch (_) { }
          }

          const cleanSlug = slugifyName(slugToClean.replace('.wynnpages.com.au', ''));
          const deletedCount = await purgeDemoSiteAssetsFromKv(env, cleanSlug);

          // In background: detach Cloudflare Worker domain if one was created
          if (cleanSlug) {
            const detachJob = removeCloudflareWorkerDomain(cleanSlug, env, effectiveCfg.cfApiToken).catch(() => {});
            if (ctx && typeof ctx.waitUntil === 'function') {
              ctx.waitUntil(detachJob);
            } else {
              await detachJob;
            }
          }

          const nowIso = new Date().toISOString();
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'purged');
          uP.append('metadata[deal_expires_at]', nowIso);
          uP.append('metadata[nurture_step]', 'demo_purged');
          uP.append('metadata[purged_at]', nowIso);

          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
          }

          return new Response(JSON.stringify({ ok: true, dealStatus: 'purged', cleanSlug, deletedCount, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Send Nurture SMS (Unified 5-Step Pipeline: Step 1 Pitch, Step 2 Day 3 Check-in, Step 3 Deal 50% 72h, Step 4 Day 9 Final Warning)
        if (action === 'send_nurture_sms' && customerId) {
          let cust = null;
          const getRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (getRes.ok) cust = await getRes.json();
          const formatted = cust ? formatCustomerRecord(cust) : null;
          if (!formatted || (!formatted.phone && !formatted.email)) {
            return new Response(JSON.stringify({ error: 'Khách hàng này chưa có SĐT hoặc Email để gửi!' }), { status: 400, headers: corsHeaders });
          }

          let templateKey = body.templateKey || 'day3_reminder';
          const biz = formatted.businessName || formatted.name || 'Boutique';
          const demoUrl = formatted.demoUrl || formatted.brandedDemoUrl || (formatted.demoSlug ? `https://${formatted.demoSlug}.wynnpages.com.au` : `https://${formatted.id}.wynnpages.com.au`);

          let realViews = Number(formatted.demoViewCount || 0);
          const cleanSlugN = slugifyName(formatted.demoSlug || biz);
          const dbN = getD1(env);
          if (dbN) {
            await ensureD1Schema(env);
            const rN = await dbN.prepare('SELECT view_count FROM clients WHERE id = ?').bind(customerId).first().catch(() => null);
            if (rN && rN.view_count) realViews = Math.max(realViews, Number(rN.view_count));
          }
          if (env && env.WYNN_KV && cleanSlugN) {
            const kvN = await env.WYNN_KV.get(`demo_views:${cleanSlugN}`, 'json').catch(() => null);
            if (kvN && kvN.viewCount) realViews = Math.max(realViews, Number(kvN.viewCount));
          }

          let smsText = '';
          if (body.customMessage && String(body.customMessage).trim()) {
            smsText = String(body.customMessage).trim();
          } else if (templateKey === 'day3_reminder') {
            if (realViews >= 2) templateKey = 'aussie_followup_views';
            smsText = buildNurtureStepSms({ stepKey: templateKey, biz, demoUrl, views: realViews });
          } else if (templateKey === 'day7_deal') {
            if (realViews === 0 && body.onlyIfViewed === true) templateKey = 'day7_nudge_0views';
            smsText = buildNurtureStepSms({ stepKey: templateKey, biz, demoUrl, views: realViews });
          } else {
            smsText = buildNurtureStepSms({ stepKey: templateKey, biz, demoUrl, views: realViews }) || (body.customMessage || '').trim();
          }

          if (!smsText) {
            return new Response(JSON.stringify({ error: 'Nội dung tin nhắn trống.' }), { status: 400, headers: corsHeaders });
          }

          const nowIso = new Date().toISOString();
          let smsRes = { sent: false, reason: 'No phone number' };
          if (formatted.phone) {
            smsRes = await sendClickSendSms({ to: formatted.phone, message: smsText, cfg: effectiveCfg });
          }
          let emailRes = null;
          let sentMailSubject = '';
          if (formatted.email && effectiveCfg.resendApiKey) {
            const mailPayload = buildNurtureStepEmail({ stepKey: templateKey, client: formatted, demoUrl, views: realViews });
            if (mailPayload) {
              sentMailSubject = mailPayload.subject || '';
              emailRes = await sendResendEmail({ to: formatted.email, subject: mailPayload.subject, html: mailPayload.html, cfg: effectiveCfg }).catch(() => null);
            }
          }

          const logMsg = formatted.phone
            ? (smsRes && smsRes.sent ? `OK (${smsRes.to}) [${templateKey}] @ ${nowIso}` : `ERR: ${(smsRes && smsRes.reason) || 'Failed'}`)
            : '';

          const uP = new URLSearchParams();
          if (logMsg) uP.append('metadata[last_sms_log]', logMsg.slice(0, 480));
          if (emailRes && emailRes.sent) {
            uP.append('metadata[last_email_log]', `OK (${formatted.email}) [${templateKey}] @ ${nowIso}`.slice(0, 480));
          }
          uP.append('metadata[nurture_step]', templateKey);
          uP.append('metadata[channel_mode]', 'sms');
          uP.append('metadata[fb_due_step]', '');
          if (templateKey === 'aussie_pitch' || templateKey === 'pitch') {
            uP.append('metadata[demo_sent_at]', nowIso);
            uP.append('metadata[sequence_started_at]', nowIso);
            uP.append('metadata[step1_sent_at]', nowIso);
            uP.append('metadata[step2_sent_at]', '');
            uP.append('metadata[step3_sent_at]', '');
            uP.append('metadata[step4_sent_at]', '');
            uP.append('metadata[step5_locked_at]', '');
            uP.append('metadata[deal_status]', 'standard');
            uP.append('metadata[deal_activated_at]', '');
            uP.append('metadata[deal_expires_at]', '');
            if (body.turboTestMode !== undefined) {
              uP.append('metadata[turbo_test_mode]', body.turboTestMode ? 'true' : 'false');
            }
            if (!formatted.stage || formatted.stage === 'outbound_pending') {
              uP.append('metadata[stage]', 'outbound_pitched');
            }
            uP.append('metadata[nurture_auto_enabled]', 'true');
          } else if (templateKey === 'day3_reminder' || templateKey === 'aussie_followup_views' || templateKey === 'followup_views') {
            uP.append('metadata[step2_sent_at]', nowIso);
          } else if (templateKey === 'day7_deal' || templateKey === 'aussie_flash_deal_299' || templateKey === 'flash_deal_299') {
            uP.append('metadata[step3_sent_at]', nowIso);
          } else if (templateKey === 'day9_warning') {
            uP.append('metadata[step4_sent_at]', nowIso);
          }
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          if (formatted.phone) {
            await recordSmsHistory({
              customerId,
              env,
              stripeSecretKey: effectiveCfg.stripeSecretKey,
              type: templateKey,
              to: formatted.phone,
              text: smsText,
              status: smsRes && smsRes.sent,
              reason: smsRes && smsRes.reason
            });
          }

          let updatedCust = formatted;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
          }
          if (updatedCust) {
            await upsertD1Client(env, updatedCust);
            runInBg(ctx, syncClientsKvSnapshot(env));
          }

          const stepTitleMap = {
            aussie_pitch: '🚀 [BƯỚC 1 - PITCH DEMO]',
            pitch: '🚀 [BƯỚC 1 - PITCH DEMO]',
            day3_reminder: '💬 [BƯỚC 2 - NGÀY 3 HỎI THĂM]',
            aussie_followup_views: '👀 [BƯỚC 2 - KHÁCH ĐÃ XEM DEMO]',
            followup_views: '👀 [BƯỚC 2 - KHÁCH ĐÃ XEM DEMO]',
            day7_nudge_0views: '👋 [NGÀY 7 - NHẮC NHẸ 0 VIEW]',
            day7_deal: '🔥 [BƯỚC 3 - FLASH DEAL $299]',
            aussie_flash_deal_299: '🔥 [BƯỚC 3 - FLASH DEAL $299]',
            flash_deal_299: '🔥 [BƯỚC 3 - FLASH DEAL $299]',
            day9_warning: '⏳ [BƯỚC 4 - CẢNH BÁO 24H CUỐI]'
          };
          const tgStepLabel = stepTitleMap[templateKey] || `📲 [NURTURE: ${templateKey}]`;
          const tgNotifyRes = await notifyTelegramAutomatedComms({
            env,
            ctx,
            client: updatedCust || formatted,
            triggerType: `nurture_${templateKey}`,
            icon: '📲',
            title: `${tgStepLabel} Đã gửi SMS/Email cho ${biz}`,
            views: realViews,
            smsSent: Boolean(smsRes && smsRes.sent),
            smsSkippedReason: smsRes && smsRes.reason,
            smsTo: (smsRes && smsRes.to) || formatted.phone,
            smsText,
            emailSent: Boolean(emailRes && emailRes.sent),
            emailSkippedReason: emailRes && emailRes.reason,
            emailTo: formatted.email,
            emailSubject: sentMailSubject,
            waitForTelegram: true
          });

          return new Response(JSON.stringify({
            ok: Boolean((smsRes && smsRes.sent) || (emailRes && emailRes.sent)),
            result: smsRes,
            emailResult: emailRes,
            telegramNotified: Boolean(tgNotifyRes && tgNotifyRes.telegramSent),
            client: updatedCust
          }), { status: 200, headers: corsHeaders });
        }

        // Action: Log Facebook Pitch / Assisted Step Sent (Step 1 Day 1, Step 2 Day 3, Step 3 Day 6, Step 4 Day 9)
        if ((action === 'log_fb_pitch' || action === 'log_fb_step') && customerId) {
          const now = new Date().toISOString();
          const fbUrl = (body.facebookUrl || '').trim();
          const stepKey = (body.stepKey || 'day1').trim();
          const uP = new URLSearchParams();
          uP.append('metadata[channel_mode]', 'facebook');
          uP.append('metadata[fb_due_step]', '');
          if (fbUrl) {
            uP.append('metadata[facebook_url]', fbUrl);
          }
          if (stepKey === 'day1' || stepKey === 'step1') {
            uP.append('metadata[fb_pitched_at]', now);
            uP.append('metadata[sequence_started_at]', now);
            uP.append('metadata[step1_sent_at]', now);
            uP.append('metadata[stage]', 'outbound_pitched');
            uP.append('metadata[nurture_step]', 'aussie_pitch');
            uP.append('metadata[nurture_auto_enabled]', 'true');
          } else if (stepKey === 'day3' || stepKey === 'step2') {
            uP.append('metadata[step2_sent_at]', now);
            uP.append('metadata[nurture_step]', 'day3_reminder');
          } else if (stepKey === 'day6' || stepKey === 'step3') {
            uP.append('metadata[step3_sent_at]', now);
            uP.append('metadata[nurture_step]', 'day7_deal_active');
            uP.append('metadata[deal_status]', 'flash_deal');
            uP.append('metadata[deal_activated_at]', now);
            uP.append('metadata[deal_expires_at]', new Date(Date.now() + 72 * 3600 * 1000).toISOString());
          } else if (stepKey === 'day9' || stepKey === 'step4') {
            uP.append('metadata[step4_sent_at]', now);
            uP.append('metadata[nurture_step]', 'day9_warning');
          } else if (stepKey === 'launched' || stepKey === 'site_launched') {
            uP.append('metadata[stage]', 'launched');
            uP.append('metadata[launched_at]', now);
          }
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
            runInBg(ctx, syncClientsKvSnapshot(env));
          }
          return new Response(JSON.stringify({ ok: true, stepKey, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Toggle 60-Minute Turbo Test Mode Per Client
        if (action === 'toggle_turbo_test' && customerId) {
          const enabled = body.enabled !== false && body.enabled !== 'false';
          const uP = new URLSearchParams();
          uP.append('metadata[turbo_test_mode]', enabled ? 'true' : 'false');
          if (enabled) {
            uP.append('metadata[nurture_auto_enabled]', 'true');
          }
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });
          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
            runInBg(ctx, syncClientsKvSnapshot(env));
          }
          return new Response(JSON.stringify({ ok: true, turboTestMode: enabled, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Fast-Forward to Next Pending Step in Turbo Test Mode
        if (action === 'fast_forward_turbo_step' && customerId) {
          let cust = null;
          const getRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (getRes.ok) cust = await getRes.json();
          const c = cust ? formatCustomerRecord(cust) : null;
          if (!c) {
            return new Response(JSON.stringify({ error: 'Không tìm thấy khách hàng!' }), { status: 404, headers: corsHeaders });
          }

          const isFbMode = c.channelMode === 'facebook' || !c.phone;
          const step1Done = Boolean(c.step1SentAt || c.demoSentAt || c.fbPitchedAt);
          const step2Done = Boolean(c.step2SentAt) || c.nurtureStep === 'day3_reminder' || c.nurtureStep === 'aussie_followup_views' || (isFbMode && c.fbDueStep === 'day3');
          const step3Done = Boolean(c.step3SentAt) || (c.dealStatus === 'flash_deal' && (!isFbMode || c.nurtureStep === 'day7_deal_active' || c.fbDueStep === 'day6')) || c.nurtureStep === 'aussie_flash_deal_299';
          const step4Done = Boolean(c.step4SentAt) || c.nurtureStep === 'day9_warning' || (isFbMode && c.fbDueStep === 'day9');

          let offsetMins = !step1Done ? 0 : (!step2Done ? 15.1 : (!step3Done ? 30.1 : (!step4Done ? 45.1 : 60.1)));
          let targetStep = !step1Done ? 'step1' : (!step2Done ? 'step2' : (!step3Done ? 'step3' : (!step4Done ? 'step4' : 'step5')));

          const shiftedIso = new Date(Date.now() - Math.round(offsetMins * 60 * 1000)).toISOString();
          const prevStepShiftedIso = new Date(Date.now() - Math.round(15.5 * 60 * 1000)).toISOString();
          const uP = new URLSearchParams();
          uP.append('metadata[turbo_test_mode]', 'true');
          uP.append('metadata[nurture_auto_enabled]', 'true');
          uP.append('metadata[sequence_started_at]', shiftedIso);
          if (c.demoSentAt || !c.fbPitchedAt) uP.append('metadata[demo_sent_at]', shiftedIso);
          if (c.fbPitchedAt) uP.append('metadata[fb_pitched_at]', shiftedIso);
          if (targetStep === 'step3' && step2Done) {
            uP.append('metadata[step2_sent_at]', prevStepShiftedIso);
          } else if (targetStep === 'step4' && step3Done) {
            uP.append('metadata[step3_sent_at]', prevStepShiftedIso);
            uP.append('metadata[deal_activated_at]', prevStepShiftedIso);
          } else if (targetStep === 'step5' && step4Done) {
            uP.append('metadata[step4_sent_at]', prevStepShiftedIso);
          }
          if (targetStep === 'step1') {
            uP.append('metadata[step1_sent_at]', shiftedIso);
            uP.append('metadata[stage]', 'outbound_pitched');
            uP.append('metadata[nurture_step]', 'aussie_pitch');
            const biz = c.businessName || c.name || 'Boutique';
            const demoUrl = c.demoUrl || c.brandedDemoUrl || `https://${c.demoSlug || c.id}.wynnpages.com.au`;
            const pitchSms = buildNurtureStepSms({ stepKey: 'step1', biz, demoUrl });
            let ffSmsRes = { sent: false, reason: c.phone ? 'Chưa cấu hình ClickSend' : 'Chưa có SĐT' };
            if (!isFbMode && c.phone && effectiveCfg.clicksendApiKey) {
              ffSmsRes = await sendClickSendSms(c.phone, pitchSms, effectiveCfg);
              await recordSmsHistory({ customerId: c.id, env, stripeSecretKey: effectiveCfg.stripeSecretKey, type: 'aussie_pitch', to: c.phone, text: pitchSms, status: ffSmsRes.sent, reason: ffSmsRes.reason });
            }
            let ffEmailRes = { sent: false, reason: c.email ? 'Chưa cấu hình Resend' : 'Chưa có Email' };
            let ffMailSubject = '';
            if (!isFbMode && c.email && effectiveCfg.resendApiKey) {
              const mailPayload = buildNurtureStepEmail({ stepKey: 'step1', client: c });
              if (mailPayload) {
                ffMailSubject = mailPayload.subject || '';
                const mRes = await sendResendEmail({ to: c.email, subject: mailPayload.subject, html: mailPayload.html, cfg: effectiveCfg }).catch((e) => ({ sent: false, reason: e.message }));
                if (mRes) ffEmailRes = mRes;
              }
            }
            if (!isFbMode && (ffSmsRes.sent || ffEmailRes.sent)) {
              await notifyTelegramAutomatedComms({
                env,
                ctx,
                client: c,
                triggerType: 'turbo_step1_pitch',
                icon: '⚡',
                title: `⚡ [TURBO BƯỚC 1] Đã gửi Pitch Demo SMS/Email: ${biz}`,
                views: Number(c.demoViewCount || 0),
                smsSent: Boolean(ffSmsRes.sent),
                smsSkippedReason: ffSmsRes.reason,
                smsTo: ffSmsRes.to || c.phone,
                smsText: pitchSms,
                emailSent: Boolean(ffEmailRes.sent),
                emailSkippedReason: ffEmailRes.reason,
                emailTo: c.email,
                emailSubject: ffMailSubject,
                waitForTelegram: true
              });
            }
          }
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });
          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
            runInBg(ctx, syncClientsKvSnapshot(env));
          }
          return new Response(JSON.stringify({ ok: true, targetStep, shiftedIso, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Reset 10-Day / 60-Min Closing Sequence Back to Clean Start ($599 AUD)
        if ((action === 'reset_closing_sequence' || action === 'reset_turbo_sequence') && customerId) {
          const uP = new URLSearchParams();
          for (const k of ['deal_activated_at', 'deal_expires_at', 'demo_sent_at', 'fb_pitched_at', 'sequence_started_at', 'step1_sent_at', 'step2_sent_at', 'step3_sent_at', 'step4_sent_at', 'step5_locked_at', 'nurture_step', 'fb_due_step', 'fb_alerted_steps']) {
            uP.append(`metadata[${k}]`, '');
          }
          uP.append('metadata[deal_status]', 'standard');
          uP.append('metadata[stage]', 'outbound_pending');
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });
          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
            runInBg(ctx, syncClientsKvSnapshot(env));
          }
          return new Response(JSON.stringify({ ok: true, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Update Subdomain (Cloudflare + KV + Stripe sync)
        if (action === 'update_subdomain' && customerId) {
          const oldSlug = slugifyName(body.oldSlug || '');
          const newSlug = slugifyName(body.newSlug || '');
          if (!newSlug) {
            return new Response(JSON.stringify({ error: 'Subdomain mới không hợp lệ!' }), { status: 400, headers: corsHeaders });
          }

          // 1. If old slug differs, remove from Cloudflare & migrate KV
          if (oldSlug && oldSlug !== newSlug) {
            await removeCloudflareWorkerDomain(oldSlug, env, effectiveCfg.cfApiToken);
            if (env && env.WYNN_KV) {
              await env.WYNN_KV.delete(`sub_${oldSlug}`).catch(() => {});
              await env.WYNN_KV.put(`sub_${newSlug}`, '1').catch(() => {});

              const oldCode = await env.WYNN_KV.get(`demo_code:${oldSlug}`).catch(() => null);
              if (oldCode) {
                await env.WYNN_KV.put(`demo_code:${newSlug}`, oldCode).catch(() => {});
                await env.WYNN_KV.delete(`demo_code:${oldSlug}`).catch(() => {});
              }
              const oldZip = await env.WYNN_KV.get(`demo_zip:${oldSlug}`).catch(() => null);
              if (oldZip) {
                await env.WYNN_KV.put(`demo_zip:${newSlug}`, oldZip).catch(() => {});
                await env.WYNN_KV.delete(`demo_zip:${oldSlug}`).catch(() => {});
              }

              const oldMetaKey = `site_meta:${oldSlug}`;
              const oldMeta = await env.WYNN_KV.get(oldMetaKey, 'json').catch(() => null);
              const filesList = (oldMeta && Array.isArray(oldMeta.filesList) && oldMeta.filesList.length) ? oldMeta.filesList : ['/index.html', '/favicon.svg', '/favicon.png', '/og-share.jpg'];
              for (const p of filesList) {
                const obj = await env.WYNN_KV.getWithMetadata(`site_asset:${oldSlug}:${p}`, 'arrayBuffer').catch(() => null);
                if (obj && obj.value) {
                  await env.WYNN_KV.put(`site_asset:${newSlug}:${p}`, obj.value, { metadata: obj.metadata || {} }).catch(() => {});
                  await env.WYNN_KV.delete(`site_asset:${oldSlug}:${p}`).catch(() => {});
                }
              }
              if (oldMeta) {
                oldMeta.slug = newSlug;
                await env.WYNN_KV.put(`site_meta:${newSlug}`, JSON.stringify(oldMeta)).catch(() => {});
                await env.WYNN_KV.delete(oldMetaKey).catch(() => {});
              }
            }
          }

          // 2. Attach new subdomain in background
          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(ensureCloudflareSubdomain(newSlug, env, effectiveCfg.cfApiToken).catch(() => {}));
          } else {
            await ensureCloudflareSubdomain(newSlug, env, effectiveCfg.cfApiToken);
          }

          // 3. Update Stripe Customer & D1
          const newDemoUrl = `https://${newSlug}.wynnpages.com.au`;
          const uP = new URLSearchParams();
          uP.append('metadata[demo_slug]', newSlug);
          uP.append('metadata[demo_url]', newDemoUrl);
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });
          let updatedCust = null;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
            await upsertD1Client(env, updatedCust);
          }
          return new Response(JSON.stringify({ ok: true, success: true, newSlug, newDemoUrl, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action 0b: Sync Existing Uploaded File to Google Drive
        if (action === 'sync_file_to_drive' && customerId) {
          if (!effectiveCfg.googleDriveWebhookUrl) {
            return new Response(
              JSON.stringify({ error: 'Chưa cấu hình Google Drive Webhook URL! Hãy bấm nút "⚙️ Cấu hình API / Google Drive" ở góc trên để kết nối.' }),
              { status: 400, headers: corsHeaders }
            );
          }
          const fileId = (body.fileId || '').trim();
          const fileName = (body.fileName || 'client-file.bin').trim();
          const fieldType = (body.fieldType || 'menu').trim(); // 'logo' | 'menu' | 'photos'
          const folderName = (body.folderName || 'WynnPages Client').trim();

          const fileRes = await fetch(`https://files.stripe.com/v1/files/${encodeURIComponent(fileId)}/contents`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (!fileRes.ok) {
            return new Response(JSON.stringify({ error: 'Không tải được file gốc từ hệ thống lưu trữ.' }), { status: 404, headers: corsHeaders });
          }
          const mimeType = fileRes.headers.get('content-type') || 'application/octet-stream';
          const arrayBuf = await fileRes.arrayBuffer();
          const base64Data = arrayBufferToBase64(arrayBuf);

          const driveRes = await uploadGoogleDriveFile(
            { name: fileName, dataUrl: `data:${mimeType};base64,${base64Data}` },
            folderName,
            effectiveCfg.googleDriveWebhookUrl
          );
          if (!driveRes || !driveRes.fileUrl) {
            return new Response(JSON.stringify({ error: 'Không thể lưu lên Google Drive. Hãy kiểm tra lại Google Drive Webhook URL.' }), { status: 500, headers: corsHeaders });
          }

          const uParams = new URLSearchParams();
          const metaKey = fieldType === 'logo' ? 'logo_drive_url' : (fieldType === 'photos' ? 'photos_drive_url' : 'menu_drive_url');
          uParams.append(`metadata[${metaKey}]`, driveRes.fileUrl.slice(0, 490));
          if (driveRes.folderUrl) {
            uParams.append('metadata[drive_folder_url]', driveRes.folderUrl.slice(0, 490));
          }
          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          });

          return new Response(JSON.stringify({ ok: true, driveUrl: driveRes.fileUrl, folderUrl: driveRes.folderUrl }), { status: 200, headers: corsHeaders });
        }

        // Action: Check Live DNS & Zone Activation Status (1-Click Smart Check in Admin)
        if (action === 'check_domain_status' && customerId) {
          let cust = null;
          const getRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (getRes.ok) cust = await getRes.json();
          const formatted = cust ? formatCustomerRecord(cust) : null;
          const rawDomain = (body.liveUrl || (formatted && (formatted.liveUrl || formatted.existingDomain || formatted.desiredDomains)) || '').trim();
          const rootDomain = extractCleanHost(rawDomain);
          if (!rootDomain || !rootDomain.includes('.')) {
            return new Response(JSON.stringify({ error: 'Vui lòng nhập Tên Miền Chính Thức trước khi kiểm tra DNS!' }), { status: 400, headers: corsHeaders });
          }

          const bindRes = await ensureCustomLiveDomainOnCloudflare(rootDomain, env, effectiveCfg.cfApiToken);
          let zoneStatus = (bindRes && bindRes.zoneStatus) || (bindRes && bindRes.reason) || 'pending';
          let assignedNs = (bindRes && bindRes.attached && bindRes.nameservers) ? bindRes.nameservers : ((formatted && formatted.cfNameservers) || '');

          // Trigger immediate activation re-check if zone exists & is still pending
          if (bindRes && bindRes.zoneId && zoneStatus !== 'active') {
            const accessToken = await getValidCloudflareToken(env, false, effectiveCfg.cfApiToken);
            if (accessToken) {
              await fetch(`https://api.cloudflare.com/client/v4/zones/${bindRes.zoneId}/activation_check`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
              }).catch(() => {});
              const reRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${bindRes.zoneId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
              }).catch(() => null);
              if (reRes && reRes.ok) {
                const reData = await reRes.json().catch(() => ({}));
                if (reData && reData.result && reData.result.status) {
                  zoneStatus = reData.result.status;
                }
              }
            }
          }

          // Live DNS-over-HTTPS NS lookup to see what nameservers the domain currently points to globally
          let liveNs = [];
          try {
            const dohRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(rootDomain)}&type=NS`, {
              headers: { 'Accept': 'application/dns-json' }
            });
            if (dohRes.ok) {
              const dohData = await dohRes.json().catch(() => ({}));
              if (Array.isArray(dohData.Answer)) {
                liveNs = dohData.Answer
                  .filter((a) => a && a.type === 2 && a.data)
                  .map((a) => String(a.data).toLowerCase().replace(/\.$/, ''));
              }
            }
          } catch (_) {}

          const expectedList = assignedNs.split(',').map((s) => s.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
          const nsMatched = expectedList.length > 0 && expectedList.every((nsItem) => liveNs.includes(nsItem));
          const isActive = zoneStatus === 'active' || nsMatched;
          const savedStatus = isActive ? 'active' : (bindRes && bindRes.reason === 'zone_pending_registration' ? 'unregistered' : 'pending');

          let updatedCustRecord = formatted;
          if (effectiveCfg.stripeSecretKey) {
            const uP = new URLSearchParams();
            uP.append('metadata[live_url]', rootDomain);
            uP.append('metadata[cf_zone_status]', savedStatus);
            if (assignedNs) uP.append('metadata[cf_nameservers]', assignedNs.slice(0, 490));
            const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: uP.toString()
            });
            if (patchRes.ok) {
              updatedCustRecord = formatCustomerRecord(await patchRes.json());
              await upsertD1Client(env, updatedCustRecord);
            }
          }

          return new Response(JSON.stringify({
            ok: true,
            rootDomain,
            isActive,
            zoneStatus: savedStatus,
            nameservers: assignedNs,
            liveNs,
            client: updatedCustRecord
          }), { status: 200, headers: corsHeaders });
        }

        // Action: Send DNS Configuration Email Manually (Optional for In-House IT Teams)
        if (action === 'send_dns_email' && customerId) {
          let cust = null;
          const getRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (getRes.ok) cust = await getRes.json();
          const formatted = cust ? formatCustomerRecord(cust) : null;
          if (!formatted || !formatted.email) {
            return new Response(JSON.stringify({ error: 'Khách hàng này chưa có email để gửi hướng dẫn DNS!' }), { status: 400, headers: corsHeaders });
          }
          if (!formatted.liveUrl) {
            return new Response(JSON.stringify({ error: 'Chưa có Tên Miền Chính Thức nào được lưu cho khách này!' }), { status: 400, headers: corsHeaders });
          }
          let nsToSend = formatted.cfNameservers || '';
          if (!nsToSend) {
            const bindRes = await ensureCustomLiveDomainOnCloudflare(formatted.liveUrl, env, effectiveCfg.cfApiToken);
            if (bindRes && bindRes.attached && bindRes.nameservers) {
              nsToSend = bindRes.nameservers;
            }
          }
          if (!nsToSend) {
            return new Response(JSON.stringify({ error: 'Tên miền này chưa được đăng ký trên hệ thống tên miền quốc tế (WHOIS) nên chưa sinh được cặp Nameservers. Hãy đợi khách mua tên miền trên VentraIP trước!' }), { status: 400, headers: corsHeaders });
          }
          const guideUrl = buildDomainGuideUrl({
            origin: url.origin,
            client: formatted,
            tab: 'existing',
            ns: nsToSend
          });
          const firstName = (formatted.name || formatted.businessName || 'there').split(' ')[0];
          const parts = nsToSend.split(',').map(s => s.trim());

          const dnsSubject = `Network Nameservers for ${formatted.liveUrl} — WynnPages Studio`;
          const mailRes = await sendResendEmail({
            to: formatted.email,
            subject: dnsSubject,
            html: buildAtelierEmailHtml({
              preheader: `Network Nameservers for ${formatted.liveUrl}`,
              heading: `Connect your domain ${formatted.liveUrl}, ${firstName}!`,
              bodyHtml: `
                <p>We have provisioned the <strong>WynnPages Studio Australian High-Speed Network</strong> configuration for your official domain: <strong>${formatted.liveUrl}</strong>.</p>
                <p>If your IT team prefers to point DNS manually, please update the <strong>Nameservers</strong> at your domain registrar to:</p>
                <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:14px 18px;margin:16px 0;font-family:monospace;font-size:13px;line-height:1.8;">
                  <div><strong>Nameserver 1:</strong> <span style="color:#96432b;font-weight:bold;">${parts[0] || ''}</span></div>
                  ${parts[1] ? `<div><strong>Nameserver 2:</strong> <span style="color:#96432b;font-weight:bold;">${parts[1]}</span></div>` : ''}
                </div>
                <p><strong>Prefer zero technical hassle?</strong> Simply invite <strong>hello@wynnpages.com.au</strong> or submit registrar access via our guide page, and our Australian engineers will connect it for you for free.</p>
              `,
              primaryCta: {
                label: 'Open Domain Connection Guide →',
                url: guideUrl
              },
              secondaryCta: {
                label: 'Visit WynnPages Studio',
                url: url.origin
              }
            }),
            cfg: effectiveCfg
          });

          await notifyTelegramAutomatedComms({
            env,
            ctx,
            client: formatted,
            triggerType: 'dns_email_sent',
            icon: '🌐',
            title: `🌐 [HƯỚNG DẪN DNS] Đã gửi Email Nameservers cho ${formatted.businessName || formatted.name || formatted.liveUrl}`,
            emailSent: Boolean(mailRes && mailRes.sent),
            emailSkippedReason: mailRes && mailRes.reason,
            emailTo: formatted.email,
            emailSubject: dnsSubject,
            extraNote: `Nameservers: ${nsToSend}`,
            waitForTelegram: true
          });

          return new Response(JSON.stringify({ ok: Boolean(mailRes && mailRes.sent), result: mailRes, guideUrl }), { status: 200, headers: corsHeaders });
        }

        // Action A: Create or Update Client + Optionally Trigger Stage Notification
        if (action === 'trigger_stage' || action === 'save_client') {
          let cust = null;
          if (customerId) {
            const getRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
              method: 'GET',
              headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
            });
            if (getRes.ok) cust = await getRes.json();
          }

          if (action === 'trigger_stage' && body.stage === 'site_launched') {
            const checkFormatted = cust ? formatCustomerRecord(cust) : null;
            const isClientPaid = body.paymentStatus === 'paid' || (checkFormatted && checkFormatted.paymentStatus === 'paid');
            const candidateLiveUrl = (body.liveUrl !== undefined ? body.liveUrl : (checkFormatted && checkFormatted.liveUrl) || '').trim();
            if (!isClientPaid) {
              return new Response(
                JSON.stringify({ error: 'Khách hàng chưa thanh toán $599 nên chưa thể báo lên sóng chính thức!' }),
                { status: 400, headers: corsHeaders }
              );
            }
            if (!candidateLiveUrl || !candidateLiveUrl.includes('.')) {
              return new Response(
                JSON.stringify({ error: 'Vui lòng nhập Tên Miền Chính Thức (Mục 2) trước khi báo lên sóng!' }),
                { status: 400, headers: corsHeaders }
              );
            }
          }

          const uParams = new URLSearchParams();
          const email = (body.email !== undefined ? body.email : (cust && cust.email) || '').trim();
          const name = (body.name !== undefined ? body.name : (cust && cust.name) || '').trim();
          const phone = (body.phone !== undefined ? body.phone : (cust && cust.phone) || '').trim();
          const candidateBizName = (body.businessName !== undefined ? body.businessName : (cust && cust.metadata && cust.metadata.business_name) || name || 'demo').trim();
          const autoSlug = (cust && cust.metadata && cust.metadata.demo_slug) || slugifyName(candidateBizName) || 'demo';
          const demoUrl = ((body.demoUrl && body.demoUrl.trim()) || (cust && cust.metadata && cust.metadata.demo_url) || `https://${autoSlug}.wynnpages.com.au`).trim();
          const stage = body.stage || (cust && cust.metadata && cust.metadata.stage) || 'paid';

          if (email) uParams.append('email', email);
          if (name) uParams.append('name', name);
          if (phone) uParams.append('phone', phone);
          uParams.append('metadata[studio]', 'WynnPages Australia');
          if (name) uParams.append('metadata[customer_name]', name);
          if (phone) uParams.append('metadata[customer_phone]', phone);
          if (email) uParams.append('metadata[customer_email]', email);
          if (body.businessName !== undefined) uParams.append('metadata[business_name]', body.businessName);
          if (body.displayPhone !== undefined) uParams.append('metadata[display_phone]', body.displayPhone);
          if (body.businessAddress !== undefined) uParams.append('metadata[business_address]', body.businessAddress);
          if (body.socialLinks !== undefined) uParams.append('metadata[social_links]', body.socialLinks);
          if (demoUrl) uParams.append('metadata[demo_url]', demoUrl);
          if (!cust || !cust.metadata || !cust.metadata.demo_slug) {
            uParams.append('metadata[demo_slug]', autoSlug);
          }
          if (body.industry !== undefined) {
            uParams.append('metadata[industry]', body.industry);
            if (body.industry) uParams.append('metadata[brief_status]', 'completed');
          }
          if (body.brandColors !== undefined) uParams.append('metadata[brand_colors]', body.brandColors);
          if (body.vibeLinks !== undefined) uParams.append('metadata[vibe_links]', body.vibeLinks);
          if (body.existingDomain !== undefined) uParams.append('metadata[existing_domain]', body.existingDomain);
          if (body.desiredDomains !== undefined) uParams.append('metadata[desired_domains]', body.desiredDomains);
          if (body.liveUrl !== undefined) uParams.append('metadata[live_url]', body.liveUrl.trim());
          if (body.flowType !== undefined) uParams.append('metadata[flow_type]', body.flowType);
          if (body.paymentStatus !== undefined) uParams.append('metadata[payment_status]', body.paymentStatus);
          if (body.googlePlaceId !== undefined) uParams.append('metadata[google_place_id]', String(body.googlePlaceId).slice(0, 100));
          if (body.googleRating !== undefined) uParams.append('metadata[google_rating]', String(body.googleRating).slice(0, 20));
          if (body.googleReviewCount !== undefined) uParams.append('metadata[google_review_count]', String(body.googleReviewCount).slice(0, 20));
          if (body.googleLeadType !== undefined) uParams.append('metadata[google_lead_type]', String(body.googleLeadType).slice(0, 50));
          if (body.googleWebsiteUri !== undefined) uParams.append('metadata[google_website_uri]', String(body.googleWebsiteUri).slice(0, 300));
          if (body.openingHours !== undefined) uParams.append('metadata[opening_hours]', String(body.openingHours).slice(0, 480));
          if (body.customerReviews !== undefined) uParams.append('metadata[customer_reviews]', String(body.customerReviews).slice(0, 480));
          if (body.dealStatus !== undefined) uParams.append('metadata[deal_status]', String(body.dealStatus).slice(0, 50));
          if (body.dealActivatedAt !== undefined) uParams.append('metadata[deal_activated_at]', String(body.dealActivatedAt).slice(0, 50));
          if (body.dealExpiresAt !== undefined) uParams.append('metadata[deal_expires_at]', String(body.dealExpiresAt).slice(0, 50));
          if (body.nurtureStep !== undefined) uParams.append('metadata[nurture_step]', String(body.nurtureStep).slice(0, 50));
          if (body.instagramUrl !== undefined) uParams.append('metadata[instagram_url]', String(body.instagramUrl).slice(0, 300));
          if (body.facebookUrl !== undefined) uParams.append('metadata[facebook_url]', String(body.facebookUrl).slice(0, 300));
          if (body.parkingInfo !== undefined) uParams.append('metadata[parking_info]', String(body.parkingInfo).slice(0, 300));
          if (body.editorialSummary !== undefined) uParams.append('metadata[editorial_summary]', String(body.editorialSummary).slice(0, 480));
          if (body.placesPhotos !== undefined) {
            const phStr = typeof body.placesPhotos === 'string' ? body.placesPhotos : JSON.stringify(body.placesPhotos);
            uParams.append('metadata[places_photos]', phStr.slice(0, 490));
          }
          if (body.demoPalette !== undefined && body.demoPalette !== 'manual') {
            uParams.append('metadata[demo_palette]', String(body.demoPalette).slice(0, 50));
          }
          if (!customerId) {
            uParams.append('metadata[demo_view_count]', '0');
            uParams.append('metadata[claim_click_count]', '0');
          }
          const stageMap = {
            payment_confirmed: 'paid',
            brief_completed: 'brief_completed',
            demo_ready: 'demo_sent',
            demo_reminder: 'reminder_sent',
            outbound_pitch: 'outbound_pitched',
            outbound_followup: 'outbound_followup',
            site_launched: 'launched'
          };
          const mappedStage = stageMap[stage] || stage;
          uParams.append('metadata[stage]', mappedStage);

          const nowIso = new Date().toISOString();
          if (action === 'trigger_stage') {
            if (stage === 'demo_ready' || stage === 'outbound_pitch') {
              uParams.append('metadata[demo_sent_at]', nowIso);
            } else if (stage === 'demo_reminder' || stage === 'outbound_followup') {
              const prevCount = Number((cust && cust.metadata && cust.metadata.reminder_count) || 0);
              uParams.append('metadata[reminder_count]', String(prevCount + 1));
            } else if (stage === 'site_launched') {
              uParams.append('metadata[launched_at]', nowIso);
            }
          }

          const saveEndpoint = customerId
            ? `https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`
            : 'https://api.stripe.com/v1/customers';

          const saveRes = await fetch(saveEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          });
          let updatedCust = await saveRes.json();
          let formatted = formatCustomerRecord(updatedCust);

          if (body.demoPalette && body.demoPalette !== 'manual') {
            await hydrateAndStoreTemplateOnServer({
              env,
              requestUrl: url.toString(),
              client: formatted,
              templateKey: body.demoPalette
            }).catch(() => {});
            formatted.demoSourceType = 'kv';
            formatted.demoPalette = body.demoPalette;
          }

          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(ensureCloudflareSubdomain(formatted.demoSlug, env, effectiveCfg.cfApiToken));
          } else {
            await ensureCloudflareSubdomain(formatted.demoSlug, env, effectiveCfg.cfApiToken);
          }

          const prevLiveUrl = (cust && cust.metadata && cust.metadata.live_url) || '';
          const shouldProvisionLiveDomain =
            Boolean(formatted.liveUrl) &&
            (extractCleanHost(formatted.liveUrl) !== extractCleanHost(prevLiveUrl) || !formatted.cfNameservers);

          let liveDomainBindResult = null;
          if (shouldProvisionLiveDomain) {
            liveDomainBindResult = await ensureCustomLiveDomainOnCloudflare(formatted.liveUrl, env, effectiveCfg.cfApiToken);
            if (liveDomainBindResult) {
              const newStatus = liveDomainBindResult.attached
                ? (liveDomainBindResult.zoneStatus || 'pending')
                : (liveDomainBindResult.reason === 'zone_pending_registration' ? 'unregistered' : 'pending');
              const newNs = liveDomainBindResult.attached ? (liveDomainBindResult.nameservers || '') : '';
              const nsChanged = newNs !== formatted.cfNameservers || newStatus !== formatted.cfZoneStatus;
              if (nsChanged) {
                const nsParams = new URLSearchParams();
                nsParams.append('metadata[cf_nameservers]', newNs.slice(0, 490));
                nsParams.append('metadata[cf_zone_status]', newStatus);
                const nsRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(formatted.id)}`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: nsParams.toString()
                });
                if (nsRes.ok) {
                  updatedCust = await nsRes.json();
                  formatted = formatCustomerRecord(updatedCust);
                }
              }
            }
          }
          let notifyRes = null;
          const shouldAutoLaunchOnSave =
            action === 'save_client' &&
            body.launchSite === true &&
            Boolean(body.liveUrl && String(body.liveUrl).trim().includes('.')) &&
            (formatted.paymentStatus === 'paid' || body.paymentStatus === 'paid');
          const effectiveNotifyStage = action === 'trigger_stage' ? stage : (shouldAutoLaunchOnSave ? 'site_launched' : '');

          if (effectiveNotifyStage) {
            notifyRes = await triggerLifecycleNotification({
              stage: effectiveNotifyStage,
              client: formatted,
              origin: url.origin,
              cfg: effectiveCfg,
              env,
              ctx,
              waitForTelegram: true
            });

            if (effectiveNotifyStage === 'site_launched') {
              const bizLaunch = formatted.businessName || formatted.name || 'Boutique';
              const cleanHost = extractCleanHost(formatted.liveUrl || '') || formatted.liveUrl || '';
              await recordStudioActivity(env, {
                type: 'site_launched',
                icon: '🚀',
                title: `Website Chính Thức Đã Lên Sóng Live: ${bizLaunch}`,
                message: `Tên miền chính thức https://${cleanHost} của "${bizLaunch}" đã được báo lên sóng Live thành công!`,
                clientName: bizLaunch,
                slug: formatted.demoSlug || ''
              }, ctx);
            }

            const logParams = new URLSearchParams();
            if (shouldAutoLaunchOnSave) {
              logParams.append('metadata[stage]', 'launched');
              logParams.append('metadata[launched_at]', nowIso);
            }
            const smsSummary = notifyRes.smsResult && notifyRes.smsResult.sent
              ? `OK (${notifyRes.smsResult.to}) [${effectiveNotifyStage}] @ ${nowIso}`
              : `ERR: ${(notifyRes.smsResult && notifyRes.smsResult.reason) || 'Skipped'} [${effectiveNotifyStage}]`;
            const emailSummary = notifyRes.emailResult && notifyRes.emailResult.sent
              ? `OK (${notifyRes.emailResult.to}) [${effectiveNotifyStage}] @ ${nowIso}`
              : `ERR: ${(notifyRes.emailResult && notifyRes.emailResult.reason) || 'Skipped'} [${effectiveNotifyStage}]`;
            logParams.append('metadata[last_sms_log]', smsSummary.slice(0, 480));
            logParams.append('metadata[last_email_log]', emailSummary.slice(0, 480));

            const logRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(formatted.id)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: logParams.toString()
            });
            if (logRes.ok) {
              updatedCust = await logRes.json();
              formatted = formatCustomerRecord(updatedCust);
            }

            if (notifyRes && notifyRes.smsResult) {
              await recordSmsHistory({
                customerId: formatted.id,
                env,
                stripeSecretKey: effectiveCfg.stripeSecretKey,
                type: `stage_${effectiveNotifyStage}`,
                to: formatted.phone,
                text: notifyRes.smsText || '',
                status: notifyRes.smsResult.sent,
                reason: notifyRes.smsResult.reason
              });
            }
          }

          await upsertD1Client(env, formatted);
          runInBg(ctx, syncClientsKvSnapshot(env));

          return new Response(JSON.stringify({
            ok: true,
            client: formatted,
            notifyRes,
            liveDomainBindResult
          }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: `Unknown admin action: ${action}` }), { status: 400, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }
    // 6b. Cloud Autopilot 24/7 Settings & Manual Trigger Endpoint (GET / POST /api/admin/autopilot)
    if (url.pathname === '/api/admin/autopilot' && (request.method === 'POST' || request.method === 'GET')) {
      try {
        const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        const auth = verifyAdminAuth(request, env, cfg, body);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.error }), { status: auth.status, headers: corsHeaders });
        }
        const subAction = body.action || 'get_settings';
        const dbApEndpoint = getD1(env);

        if (subAction === 'get_settings') {
          let settings = { enabled: true, autoSms: true, autoDeal: true, autoExpire: true };
          let lastRun = null;
          if (dbApEndpoint) {
            await ensureD1Schema(env);
            const sRow = await dbApEndpoint.prepare('SELECT value FROM settings WHERE key = ?').bind('studio_autopilot_settings').first().catch(() => null);
            const rRow = await dbApEndpoint.prepare('SELECT value FROM settings WHERE key = ?').bind('studio_autopilot_last_run').first().catch(() => null);
            if (sRow && sRow.value) { try { settings = { ...settings, ...JSON.parse(sRow.value) }; } catch (_) {} }
            else if (env && env.WYNN_KV) { settings = (await env.WYNN_KV.get('studio_autopilot_settings', 'json').catch(() => null)) || settings; }
            if (rRow && rRow.value) { try { lastRun = JSON.parse(rRow.value); } catch (_) {} }
            else if (env && env.WYNN_KV) { lastRun = await env.WYNN_KV.get('studio_autopilot_last_run', 'json').catch(() => null); }
          } else if (env && env.WYNN_KV) {
            settings = (await env.WYNN_KV.get('studio_autopilot_settings', 'json').catch(() => null)) || settings;
            lastRun = await env.WYNN_KV.get('studio_autopilot_last_run', 'json').catch(() => null);
          }
          return new Response(JSON.stringify({ ok: true, settings, lastRun }), { status: 200, headers: corsHeaders });
        }

        if (subAction === 'update_settings') {
          const newSettings = {
            enabled: Boolean(body.enabled),
            autoSms: Boolean(body.autoSms),
            autoDeal: Boolean(body.autoDeal),
            autoExpire: Boolean(body.autoExpire)
          };
          if (dbApEndpoint) {
            await ensureD1Schema(env);
            await dbApEndpoint.prepare(
              'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
            ).bind('studio_autopilot_settings', JSON.stringify(newSettings), new Date().toISOString()).run().catch(() => {});
          } else if (env && env.WYNN_KV) {
            await env.WYNN_KV.put('studio_autopilot_settings', JSON.stringify(newSettings)).catch(() => {});
          }
          return new Response(JSON.stringify({ ok: true, settings: newSettings }), { status: 200, headers: corsHeaders });
        }

        if (subAction === 'run_now') {
          const result = await runScheduledAutopilot(env, { force: true, ctx });
          return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: 'Unknown autopilot action' }), { status: 400, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7. Default static assets fetch with Cloudflare Edge Caching Headers
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status >= 300 && assetRes.status < 400) {
        return assetRes;
      }
      const newHeaders = new Headers(assetRes.headers);
      if (
        url.pathname.startsWith('/admin') ||
        url.pathname.startsWith('/templates') ||
        url.pathname.startsWith('/clients') ||
        url.pathname.startsWith('/preview') ||
        url.pathname.startsWith('/revision') ||
        url.pathname === '/sw.js' ||
        url.pathname === '/manifest.json'
      ) {
        newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else if (/\.svg$/i.test(url.pathname)) {
        newHeaders.set('Cache-Control', 'public, max-age=0, must-revalidate');
      } else if (
        url.pathname.startsWith('/assets/') ||
        /\.(css|woff2?|ttf|otf|png|jpg|jpeg|webp|ico)$/i.test(url.pathname)
      ) {
        newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers: newHeaders
      });
    }
    return fetch(request);
  },
  async scheduled(event, env, ctx) {
    const combinedJob = Promise.allSettled([
      processDueScheduledSms(env, ctx),
      runScheduledAutopilot(env, { force: false, fromPing: true, ctx })
    ]);
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(combinedJob);
    } else {
      await combinedJob;
    }
  }
};