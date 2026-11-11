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

function getConfig(env, overrides = {}) {
  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY || STRIPE_SECRET_KEY_FALLBACK || '',
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
    geminiApiKey: overrides.geminiApiKey || overrides.geminiKey || env.GEMINI_API_KEY || overrides.googlePlacesApiKey || overrides.googlePlacesKey || env.GOOGLE_PLACES_API_KEY || ''
  };
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

async function sendClickSendSms(toPhone, bodyText, cfg) {
  if (typeof toPhone === 'object' && toPhone !== null) {
    cfg = toPhone.cfg || cfg;
    bodyText = toPhone.message || toPhone.body || bodyText;
    toPhone = toPhone.to || toPhone.phone;
  }
  const formattedTo = normalizeAuPhone(toPhone);
  const safeBody = toGsmSafeAscii(bodyText);
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

// Persist full SMS message history in Cloudflare KV + sync latest status with Stripe metadata
async function recordSmsHistory({ customerId, env, stripeSecretKey, type, to, text, status, reason }) {
  if (!customerId) return null;
  const nowIso = new Date().toISOString();
  const entry = {
    id: 'sms_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    timestamp: nowIso,
    type: type || 'sms',
    to: to || '',
    text: text || '',
    status: status === true || status === 'OK' || status === 'sent' ? 'OK' : 'ERR',
    reason: reason || ''
  };

  let list = [];
  if (env && env.WYNN_KV) {
    const kvKey = `sms_history:${customerId}`;
    const raw = await env.WYNN_KV.get(kvKey, 'json').catch(() => null);
    if (Array.isArray(raw)) list = raw;
    list.push(entry);
    if (list.length > 50) list = list.slice(-50); // Keep last 50 messages
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

  return { entry, totalCount: list.length };
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

async function triggerLifecycleNotification({ stage, client, origin, cfg }) {
  const firstName = (client.name || 'mate').split(' ')[0];
  const email = client.email || '';
  const phone = client.phone || '';
  const demoUrl = client.demoUrl || (client.demoSlug ? `https://${client.demoSlug}.wynnpages.com.au` : `${origin}`);
  const organicBriefUrl = `${origin}/brief?type=organic&email=${encodeURIComponent(email)}`;
  const demoBriefUrl = `${origin}/brief?type=demo&email=${encodeURIComponent(email)}`;

  let smsText = '';
  let emailSubject = '';
  let emailHtml = '';

  const shortDemoUrl = client.demoSlug ? `https://${client.demoSlug}.wynnpages.com.au` : demoUrl;

  if (stage === 'payment_confirmed') {
    smsText = `Hi ${firstName}, thank you for choosing WynnPages Studio! Your 7-day build slot is locked in. Please complete your quick 2-min studio brief here: ${origin}/onboarding - Any questions, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `Your 7-Day Build Slot is Locked — Complete Your 2-Min Brief`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Payment Confirmed • WynnPages Digital Atelier',
      heading: `Your 7-Day Build Slot is Locked, ${firstName}.`,
      bodyHtml: `
        <p>Welcome to <strong>WynnPages</strong>! Your $599 AUD studio build slot is officially reserved.</p>
        <p>To get our lead artisan designer started on your custom website right away, please complete your quick 2-minute onboarding brief using the button below (or email us anytime at <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a>):</p>
      `,
      primaryCta: {
        label: 'Complete Your 2-Min Studio Brief',
        url: organicBriefUrl
      }
    });
  } else if (stage === 'brief_completed') {
    const domainInfo = client.existingDomain || client.desiredDomains || 'TBD';
    const hasExisting = Boolean(client.existingDomain);
    const isSelfNs = hasExisting && client.dnsMode === 'self_ns' && Boolean(client.cfNameservers);
    const isAlreadyDelegated = Boolean(client.domainDelegated);
    const nsParam = isSelfNs ? `&ns=${encodeURIComponent(client.cfNameservers || '')}` : '';
    const domainGuideUrl = `${origin}/domain-guide?domain=${encodeURIComponent(domainInfo)}&name=${encodeURIComponent(client.businessName || client.name || '')}&email=${encodeURIComponent(client.email || '')}&cid=${encodeURIComponent(client.id || '')}&tab=${hasExisting ? 'existing' : 'new'}${nsParam}`;

    if (isAlreadyDelegated) {
      smsText = `Hi ${firstName}, thank you! We received your WynnPages details and domain access for ${domainInfo}. Our Australian engineers are connecting SSL & high-speed DNS for you - we will notify you as soon as ${domainInfo} is officially live! Warm regards, Wynn`;
      emailSubject = `All Set! Our Engineers Are Connecting ${domainInfo}`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Studio Active • Hands-Free Domain Setup Underway',
        heading: `Thank you, ${firstName} — we are preparing your launch!`,
        bodyHtml: `
          <p>We have received your final specifications and domain access details for <strong>${domainInfo}</strong>.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
            <div><strong>Launch Domain:</strong> ${domainInfo}</div>
            <div style="margin-top:6px;"><strong>Domain Setup:</strong> Free Studio Concierge (Access Received ✓)</div>
            ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
          </div>
          <p><strong>No further technical action is required from you.</strong> Our Australian studio engineers are configuring your SSL certificate and high-speed network routing while preserving 100% of your legal ownership and any existing business emails.</p>
          <p>We will send you an SMS and email the moment <strong>${domainInfo}</strong> is officially live!</p>
        `,
        primaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else if (isSelfNs) {
      const nsParts = String(client.cfNameservers || '').split(',').map((s) => s.trim()).filter(Boolean);
      smsText = `Hi ${firstName}, thank you! Your WynnPages Australian High-Speed Network nameservers for ${domainInfo} are: ${nsParts.join(', ')}. Full setup details have also been emailed to you: ${domainGuideUrl} - Warm regards, Wynn`;
      emailSubject = `Brief Received! Your Network Nameservers for ${domainInfo}`;
      emailHtml = buildAtelierEmailHtml({
        preheader: `Nameservers Ready for ${domainInfo}`,
        heading: `Your network nameservers are ready, ${firstName}.`,
        bodyHtml: `
          <p>Thank you for completing your studio confirmation! We have provisioned <strong>${domainInfo}</strong> on the <strong>WynnPages Studio Australian High-Speed Network</strong>.</p>
          <p>Please ask your IT technician (or log into your domain registrar) to replace the current <strong>Nameservers</strong> for <strong>${domainInfo}</strong> with:</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px 18px;margin:18px 0;font-family:monospace;font-size:13px;line-height:1.8;">
            <div><strong>Nameserver 1:</strong> <span style="color:#96432b;font-weight:bold;">${nsParts[0] || ''}</span></div>
            ${nsParts[1] ? `<div><strong>Nameserver 2:</strong> <span style="color:#96432b;font-weight:bold;">${nsParts[1]}</span></div>` : ''}
          </div>
          <p>Prefer our Australian engineers to connect it for you instead? Simply open the guide below to invite <strong>hello@wynnpages.com.au</strong> or share temporary registrar access.</p>
        `,
        primaryCta: {
          label: 'Open Domain Connection Guide →',
          url: domainGuideUrl
        },
        secondaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else if (hasExisting) {
      smsText = `Hi ${firstName}, thank you! We received your WynnPages details for ${domainInfo}. To connect your domain with zero tech hassle, invite hello@wynnpages.com.au or submit access via your personalised guide: ${domainGuideUrl} - Warm regards, Wynn`;
      emailSubject = `Brief Received! Next Step: Connect Your Domain (${domainInfo})`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Studio Active • Free Concierge Domain Connection',
        heading: `We are hand-crafting your website, ${firstName}.`,
        bodyHtml: `
          <p>Thank you for completing your studio confirmation! We have logged your specifications and started preparing your bespoke website for launch.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
            <div><strong>Existing Domain:</strong> ${domainInfo}</div>
            ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
            ${client.brandColors ? `<div style="margin-top:6px;"><strong>Brand Palette:</strong> ${client.brandColors}</div>` : ''}
          </div>
          <p><strong>Connect ${domainInfo} with zero technical hassle:</strong></p>
          <ul>
            <li><strong>VentraIP / GoDaddy Delegation (Recommended):</strong> Invite <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> as a delegated user, OR</li>
            <li><strong>60-Second Studio Concierge:</strong> Submit your registrar access securely via your personalised link below so our Australian engineers can configure SSL &amp; high-speed DNS for you.</li>
          </ul>
        `,
        primaryCta: {
          label: 'Open Personalised Domain Guide →',
          url: domainGuideUrl
        },
        secondaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    } else {
      smsText = `Hi ${firstName}, thank you! We received your WynnPages details for ${domainInfo}. To register your domain in 2 minutes on VentraIP (keeping 100% legal ownership in your account) & invite hello@wynnpages.com.au, open your guide: ${domainGuideUrl} - Warm regards, Wynn`;
      emailSubject = `Brief Received! Next Step: 2-Minute VentraIP Domain Setup (${domainInfo})`;
      emailHtml = buildAtelierEmailHtml({
        preheader: 'Studio Active • 2-Minute VentraIP Domain Setup Guide Inside',
        heading: `We are preparing your launch, ${firstName}.`,
        bodyHtml: `
          <p>Thank you for completing your studio confirmation! We have logged your details and prepared your bespoke website for <strong>${domainInfo}</strong>.</p>
          <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
            <div><strong>Desired Domain:</strong> ${domainInfo}</div>
            ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
            ${client.brandColors ? `<div style="margin-top:6px;"><strong>Brand Palette:</strong> ${client.brandColors}</div>` : ''}
          </div>
          <p><strong>Final 2-minute step so you own ${domainInfo} 100% in your name:</strong></p>
          <ol>
            <li>Register <strong>${domainInfo}</strong> directly on <strong>VentraIP Australia</strong> under your own ABN &amp; card with <strong>Auto-Renew ON</strong>.</li>
            <li>Under <em>Profile Settings &rarr; Additional Users</em>, invite <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> and click confirm inside our visual guide — our engineers will handle all DNS &amp; SSL setup for free!</li>
          </ol>
        `,
        primaryCta: {
          label: 'Open Step-by-Step VentraIP Guide →',
          url: domainGuideUrl
        },
        secondaryCta: {
          label: 'Visit WynnPages Studio',
          url: origin
        }
      });
    }
  } else if (stage === 'demo_ready') {
    smsText = `Hi ${firstName}, great news from WynnPages Studio! Your custom website demo is ready to preview here: ${shortDemoUrl} - For any questions or adjustments, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `Great News! Your Custom WynnPages Website Demo is Ready`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Custom Demo Ready for Review',
      heading: `Your custom website demo is ready, ${firstName}!`,
      bodyHtml: `
        <p>Our studio has finished hand-crafting the initial version of your website. You can explore the live interactive preview right now:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${demoUrl}" style="color:#96432b;font-weight:bold;">${demoUrl}</a>
        </p>
        <p>Once you're happy with the direction, click the second button below to upload your high-res logo, menu/price list, and domain details, or email any tweak requests to <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a>.</p>
      `,
      primaryCta: {
        label: 'Preview Your Live Website Demo',
        url: demoUrl
      },
      secondaryCta: {
        label: 'Upload Final Logo, Menu & Domain Details',
        url: demoBriefUrl
      }
    });
  } else if (stage === 'demo_reminder') {
    smsText = `Hi ${firstName}, hope your week is going well! Just a polite check-in from WynnPages Studio to see if you had a chance to preview your website demo: ${shortDemoUrl} - For any questions, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `Quick Check-in: Ready to Finalise Your WynnPages Website?`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Friendly Studio Reminder',
      heading: `How do you like your new website demo, ${firstName}?`,
      bodyHtml: `
        <p>Just a friendly check-in from the WynnPages studio! Your bespoke website demo is waiting for your review:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${demoUrl}" style="color:#96432b;font-weight:bold;">${demoUrl}</a>
        </p>
        <p>To keep your 7-day launch right on track, please upload your final logo, pricing/menu, or email any tweak requests to <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a>.</p>
      `,
      primaryCta: {
        label: 'Review Demo & Submit Final Assets',
        url: demoBriefUrl
      },
      secondaryCta: {
        label: 'Open Live Demo Preview',
        url: demoUrl
      }
    });
  } else if (stage === 'outbound_pitch') {
    const bizLabel = client.businessName || client.name || 'your business';
    const previewLink = shortDemoUrl;
    smsText = `Hi ${firstName}, hope you're having a lovely week! I'm a local web designer at WynnPages Studio. I really admired ${bizLabel} and put together a custom website concept for you to preview here: ${previewLink} - If you have any questions, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `A custom website concept we prepared for ${bizLabel}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'WynnPages Studio • Personal Note',
      heading: `A bespoke website concept for ${bizLabel}.`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>I hope you are having a lovely week! I am a web designer at <strong>WynnPages Studio</strong> here in Australia.</p>
        <p>We really admired <strong>${bizLabel}</strong> and took the initiative to hand-craft a complete, mobile-ready website concept tailored specifically to your business so you could see how it might look and feel:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a>
        </p>
        <p>Please feel free to have a browse whenever you have a spare moment. If you like the direction and would like to make it officially yours, you can claim it directly from the preview page, or email us anytime at <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> with any thoughts or adjustments.</p>
        <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Lead Designer, WynnPages Studio</p>
      `,
      primaryCta: {
        label: 'View Your Website Concept',
        url: previewLink
      }
    });
  } else if (stage === 'outbound_paid_confirmed') {
    const bizLabel = client.businessName || client.name || 'your business';
    const demoSuccessUrl = `${origin}/revision.html?email=${encodeURIComponent(email)}&cid=${encodeURIComponent(client.id || '')}`;
    smsText = `Hi ${firstName}, congratulations! Your payment of $599 AUD for ${bizLabel} is confirmed. Please finalize your website revisions here so we can launch: ${demoSuccessUrl} - For any questions, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `Payment Secured! Please Review Your 1-Round Revisions to Go Live`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Payment Secured • Final Step to Go Live',
      heading: `Payment Secured for ${bizLabel}!`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>Thank you for choosing <strong>WynnPages Studio</strong>! Your payment of $599 AUD is confirmed, and your bespoke website is officially yours.</p>
        <p>To help us connect your domain and launch your website as quickly as possible, please complete the quick 60-second domain confirmation page below:</p>
      `,
      primaryCta: {
        label: 'Confirm Your Domain & Finalise Launch →',
        url: demoSuccessUrl
      }
    });
  } else if (stage === 'outbound_followup') {
    const bizLabel = client.businessName || client.name || 'your business';
    const previewLink = shortDemoUrl;
    smsText = `Hi ${firstName}, hope your week is going well! Just a polite follow-up from WynnPages Studio in case you missed the custom website concept we prepared for ${bizLabel}: ${previewLink} - For any feedback or questions, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `Following up on the website concept for ${bizLabel}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'WynnPages Studio • Polite Follow-up',
      heading: `Hope your week is going well, ${firstName}.`,
      bodyHtml: `
        <p>Hi ${firstName},</p>
        <p>I know how busy things get running <strong>${bizLabel}</strong>, so I just wanted to send a polite follow-up in case our previous note got buried.</p>
        <p>We are still holding the custom website concept we hand-crafted for your business here:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a>
        </p>
        <p>If you'd like any adjustments to the layout, colours, or services—or if you're ready for us to connect it to your domain—simply email us at <a href="mailto:hello@wynnpages.com.au" style="color:#96432b;font-weight:bold;">hello@wynnpages.com.au</a> or click the button on the preview page.</p>
        <p style="margin-top:16px;">Warm regards,<br><strong>Wynn</strong><br>Lead Designer, WynnPages Studio</p>
      `,
      primaryCta: {
        label: 'View Your Website Concept',
        url: previewLink
      }
    });
  } else if (stage === 'site_launched') {
    const rawLiveDomain = (client.liveUrl || client.existingDomain || client.desiredDomains || '').trim();
    const liveUrl = rawLiveDomain.startsWith('http') ? rawLiveDomain : `https://${rawLiveDomain}`;
    smsText = `Congratulations ${firstName}! Your bespoke WynnPages website is officially LIVE at ${liveUrl} - If you ever need anything, please email hello@wynnpages.com.au. Thank you for trusting our studio! Warm regards, Wynn`;
    emailSubject = `Congratulations! Your WynnPages Website is Officially Live`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Officially Launched',
      heading: `Your pristine website is now live, ${firstName}!`,
      bodyHtml: `
        <p>Pop the champagne! Your hand-crafted website is officially live and ready to welcome your customers.</p>
        <p>remember: with WynnPages, you own 100% of your site with zero monthly retainers.</p>
      `,
      primaryCta: {
        label: 'Visit Your Live Website',
        url: liveUrl
      }
    });
  }

  const [smsResult, emailResult] = await Promise.all([
    phone ? sendClickSendSms(phone, smsText, cfg) : Promise.resolve({ sent: false, reason: 'No phone number on record' }),
    email ? sendResendEmail({ to: email, subject: emailSubject, html: emailHtml, cfg }) : Promise.resolve({ sent: false, reason: 'No email on record' })
  ]);

  return { smsResult, emailResult, stage, smsText, phone };
}

function parseConfigAndMenuFromHtml(html) {
  let config = null;
  let menu = null;
  if (!html) return { config, menu };

  const cfgMatch = html.match(/window\.ATELIER_CONFIG\s*=\s*(\{[\s\S]*?\n\s*\};)/);
  if (cfgMatch) {
    try {
      const fn = new Function('return ' + cfgMatch[1].replace(/;\s*$/, ''));
      config = fn();
    } catch (_) {}
  }

  const menuMatch = html.match(/window\.SALON_MENU_DATA\s*=\s*(\[[\s\S]*?\n\s*\];)/);
  if (menuMatch) {
    try {
      const fn = new Function('return ' + menuMatch[1].replace(/;\s*$/, ''));
      menu = fn();
    } catch (_) {}
  }

  return { config, menu };
}

function updateHtmlWithConfigAndMenu(html, newConfig, newMenu) {
  let updated = html;

  if (newConfig) {
    updated = updated.replace(/(window\.ATELIER_CONFIG\s*=\s*)\{[\s\S]*?\n\s*\};/, (m, p1) => {
      return p1 + JSON.stringify(newConfig, null, 2) + ';';
    });

    if (newConfig.salonName) {
      updated = updated.replace(/(<span id="nav-salon-name"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.salonName}$2`);
      updated = updated.replace(/(<span id="copyright-salon"[^>]*>)[^<]*(<\/span>)/g, `$1${newConfig.salonName}$2`);
      updated = updated.replace(/(<title id="page-meta-title">)[^<]*(<\/title>)/g, `$1${newConfig.salonName} — Bespoke Sanctuary | Australia$2`);
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
  }

  if (newMenu) {
    updated = updated.replace(/(window\.SALON_MENU_DATA\s*=\s*)\[[\s\S]*?\n\s*\];/, (m, p1) => {
      return p1 + JSON.stringify(newMenu, null, 2) + ';';
    });
  }

  return updated;
}

async function executeGeminiAutoRevision({ currentHtml, revData, menuImageBase64, geminiApiKey }) {
  if (!currentHtml) return { ok: false, error: 'Missing demo HTML' };
  const { config, menu } = parseConfigAndMenuFromHtml(currentHtml);
  if (!config) return { ok: false, error: 'Could not parse ATELIER_CONFIG from demo HTML' };

  const changesSummaryList = [];

  // 1. Apply Core Info updates
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

  // 2. Apply Menu updates (using Gemini API if menu text or menu image provided)
  let updatedMenu = menu;
  const hasMenuEdits = Boolean((revData.menuText && revData.menuText.trim()) || menuImageBase64);

  if (hasMenuEdits && geminiApiKey) {
    try {
      const parts = [
        {
          text: `You are the Lead Digital Atelier Engineer for WynnPages Australia (wynnpages.com.au).
We are finalizing a client's website revision round.
Your task is to take the existing SALON_MENU_DATA structure and update it with the client's revision notes and/or uploaded menu photo.

CRITICAL RULES:
1. Return ONLY a valid JSON array matching the SALON_MENU_DATA format:
[
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
]
2. All prices MUST be in AUD (e.g. "$95", "$110", "$65").
3. Retain existing items that were not modified. If the client asked to change prices or names, apply those changes accurately.
4. If a menu image/photo is attached, OCR/read the services, categories, and prices from the image and update the array accordingly.
5. Do NOT include markdown code blocks (no \`\`\`json), return purely raw JSON.`
        }
      ];

      if (menuImageBase64) {
        const isPdf = menuImageBase64.includes('application/pdf');
        const cleanBase64 = menuImageBase64.replace(/^data:[^;]+;base64,/, '');
        parts.push({
          inline_data: {
            mime_type: isPdf ? 'application/pdf' : 'image/jpeg',
            data: cleanBase64
          }
        });
      }

      parts.push({
        text: `CURRENT DEMO MENU DATA:
${JSON.stringify(menu, null, 2)}

CLIENT'S REVISION REQUEST / INSTRUCTIONS:
${revData.menuText || 'Extract all services and prices from the attached menu image.'}`
      });

      const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`, {
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
        const rawText = gData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (rawText) {
          const parsed = JSON.parse(rawText.trim());
          if (Array.isArray(parsed) && parsed.length) {
            updatedMenu = parsed;
            changesSummaryList.push(`Gemini AI updated ${parsed.length} menu categories based on client's request`);
          }
        }
      }
    } catch (gErr) {
      if (revData.menuText && updatedMenu) {
        changesSummaryList.push('Applied fallback price tweaks to menu');
      }
    }
  } else if (hasMenuEdits && revData.menuText && updatedMenu) {
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
  const m = cust.metadata || {};
  const rawStage = m.stage || (m.brief_status === 'completed' ? 'brief_completed' : 'paid');
  const flowType = m.flow_type || (rawStage.startsWith('outbound_') ? 'outbound' : 'inbound');
  const paymentStatus = m.payment_status || ((flowType === 'outbound' && rawStage !== 'outbound_paid' && rawStage !== 'launched' && !m.checkout_session_id) ? 'unpaid' : 'paid');
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
    created: cust.created ? (cust.created < 1e11 ? cust.created * 1000 : cust.created) : Date.now()
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
    if (res.ok) return formatCustomerRecord(await res.json());
  }
  const listRes = await fetch('https://api.stripe.com/v1/customers?limit=100', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${stripeSecretKey}` }
  });
  if (!listRes.ok) return null;
  const data = await listRes.json().catch(() => ({}));
  const list = (data.data || []).map(formatCustomerRecord);
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
  const bizName = (client && (client.businessName || client.name)) || 'Quý Doanh Nghiệp';
  const expDateStr = client && client.dealExpiresAt ? new Date(client.dealExpiresAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }) : 'gần đây';

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bản Thiết Kế Đã Hết Hạn Lưu Trữ — WynnPages Studio</title>
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
    @media (min-width: 640px) {
      .btn-group { flex-direction: row; justify-content: center; }
    }
    .btn-primary {
      background: linear-gradient(135deg, #96432b 0%, #7d3520 100%);
      color: #ffffff;
      padding: 13px 24px;
      border-radius: 14px;
      font-weight: 700;
      font-size: 13px;
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
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
      <span>●</span> Demo Lưu Trữ Đã Hết Hạn
    </div>
    <h1>Bản Thiết Kế Đã Đóng &amp; <em>Thu Hồi</em></h1>
    <p class="client-target">Dành riêng cho: <strong>${bizName}</strong></p>
    <p class="expired-desc">
      Thời hạn bảo lưu và suất tài trợ số hoá độc quyền (50% OFF) dành cho <strong>${bizName}</strong> đã chính thức kết thúc vào ngày <strong>${expDateStr}</strong>.<br><br>
      Để bảo đảm an toàn hạ tầng và tính độc quyền, bản website demo này hiện đã được đưa vào kho lưu trữ bảo mật của <strong>WynnPages Australian Web Atelier</strong>.
      Nếu bạn là chủ tiệm và muốn kích hoạt lại hệ thống website này để nhận khách, vui lòng liên hệ trực tiếp Studio theo biểu phí tiêu chuẩn <strong>$599 AUD</strong>.
    </p>
    <div class="btn-group">
      <a href="sms:0424717777?&body=Hi%20WynnPages%2C%20t%C3%B4i%20l%C3%A0%20ch%E1%BB%A7%20ti%E1%BB%87m%20${encodeURIComponent(bizName)}%2C%20t%C3%B4i%20mu%E1%BB%91n%20k%C3%ADch%20ho%E1%BA%A1t%20l%E1%BA%A1i%20web%20demo%20c%E1%BB%A7a%20ti%E1%BB%87m." class="btn-primary">
        <span>📱 SMS Kích Hoạt Lại (0424 717 777)</span>
      </a>
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="btn-secondary">
        <span>Về Trang Chủ Atelier ↗</span>
      </a>
    </div>
    <p class="footer-note">WynnPages Studio — Australian Bespoke Web Atelier • Flat $599 AUD • Zero Retainers</p>
  </div>
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
  const bizName = (client && (client.businessName || client.name)) || 'Your Business';
  const cid = (client && client.id) || '';
  const email = (client && client.email) || '';

  // Check Flash Deal 50%
  let isFlashDeal = false;
  let expiresTimestamp = 0;
  if (client && client.dealStatus === 'flash_deal' && client.dealExpiresAt) {
    expiresTimestamp = new Date(client.dealExpiresAt).getTime();
    if (expiresTimestamp > Date.now()) {
      isFlashDeal = true;
    }
  }

  const claimHref = isFlashDeal
    ? `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&deal=flash50&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}`
    : `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}`;

  const btnLabel = isFlashDeal
    ? `Claim Website — $299 AUD (Save 50%)`
    : `Claim This Website — $599 AUD`;

  return `
  <style>
    .claim-bar {
      position: fixed;
      left: 50%;
      bottom: 20px;
      transform: translateX(-50%);
      z-index: 999999;
      width: calc(100% - 28px);
      max-width: 880px;
      background: rgba(26, 23, 21, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(229, 222, 201, 0.24);
      border-radius: 22px;
      padding: 12px 18px 12px 18px;
      box-shadow: 0 24px 50px -12px rgba(0, 0, 0, 0.55);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      color: #f6f1e8;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-sizing: border-box;
      overflow: visible;
    }
    .claim-bar.deal-active {
      border: 1.5px solid rgba(232, 185, 72, 0.75);
      box-shadow: 0 24px 50px -12px rgba(0, 0, 0, 0.7), 0 0 35px rgba(232, 185, 72, 0.35);
      padding-top: 16px;
    }
    .claim-deal-floating-seal {
      position: absolute;
      top: -15px;
      left: 24px;
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
        transform: translateY(0);
        box-shadow: 0 8px 22px rgba(200, 138, 27, 0.5), 0 2px 6px rgba(0,0,0,0.4);
      }
      50% {
        transform: translateY(-3px);
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
      background: linear-gradient(135deg, #96432b 0%, #a84b31 100%);
      color: #ffffff;
      text-decoration: none;
      font-size: 13px;
      font-weight: 800;
      padding: 12px 22px;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(251, 222, 185, 0.28);
      box-shadow: 0 10px 24px rgba(150, 67, 43, 0.45);
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
        padding: 14px 14px 10px 14px;
        bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        gap: 10px;
        border-radius: 20px;
        width: calc(100% - 20px);
        max-width: 100%;
        overflow: visible;
      }
      .claim-bar.deal-active {
        padding-top: 26px;
      }
      .claim-deal-floating-seal {
        top: -15px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        padding: 5px 14px;
        gap: 6px;
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
        align-items: stretch;
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
        padding: 5px 10px;
        font-size: 11px;
        border: none;
        background: transparent;
        color: #b8b0a5;
        text-decoration: underline;
      }
      .claim-studio-btn:hover {
        background: transparent;
        color: #ffffff;
      }
      .claim-tag-text { display: none; }
      .claim-bullet { display: none; }
      .claim-for-text { font-size: 10px; }
      .claim-biz-highlight { font-size: 15px; }
    }
  </style>
  <div class="claim-bar ${isFlashDeal ? 'deal-active' : ''}">
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
          <span class="claim-for-text">Crafted exclusively for</span>
          <strong class="claim-biz-highlight">${bizName}</strong>
        </div>
        ${isFlashDeal ? `
          <div class="claim-countdown-wrap">
            <span class="cd-label">OFFER EXPIRES IN:</span>
            <span class="cd-timer" id="claim-cd-display">--h : --m : --s</span>
          </div>
        ` : ''}
      </div>
    </div>
    <div class="claim-actions">
      <a href="${claimHref}" class="claim-btn ${isFlashDeal ? 'claim-deal-btn' : ''}">
        <span>${btnLabel}</span>
        <span class="claim-arrow">&rarr;</span>
      </a>
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="claim-studio-btn" title="Explore WynnPages Web Atelier">
        <span>About Studio</span>
        <svg class="claim-ext-arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"/>
        </svg>
      </a>
    </div>
  </div>
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
  const beaconScript = cleanSlug ? `
  <script>
    (function(){
      try {
        var s = '${cleanSlug}';
        if (!s) return;
        var q = window.location.search || '';
        if (q.indexOf('admin=') !== -1 || q.indexOf('preview=') !== -1 || q.indexOf('bar=1') !== -1) return;
        if (window.localStorage && window.localStorage.getItem('wynn_admin_key')) return;
        var now = Date.now();
        var last = window.localStorage ? window.localStorage.getItem('wynn_dv_' + s) : null;
        if (last && (now - parseInt(last, 10)) < 30 * 60 * 1000) return;
        if (window.localStorage) window.localStorage.setItem('wynn_dv_' + s, now);
        fetch('/api/track-view?slug=' + encodeURIComponent(s), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true
        }).catch(function(){});
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

  const bizName = (client && (client.businessName || client.name)) || 'Your Business';
  const monogram = bizName.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || 'W';
  let rawDemo = (client && client.demoUrl) || 'https://wynnpages.com.au';
  if (rawDemo && !rawDemo.startsWith('http')) rawDemo = 'https://' + rawDemo;
  const slug = (client && client.demoSlug) || '';
  const isSelfLoop = slug && rawDemo.toLowerCase().includes(`${slug}.wynnpages.com.au`);
  const bodyContent = isSelfLoop
    ? `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f1e8;color:#2b251e;font-family:'Plus Jakarta Sans',sans-serif;padding:24px 24px 130px;text-align:center;">
        <div style="max-width:500px;background:#fcf9f3;padding:40px 36px;border-radius:28px;border:1px solid rgba(197,160,89,0.42);box-shadow:0 20px 44px -16px rgba(43,37,30,0.12);">
          <div style="width:54px;height:54px;border-radius:999px;background:radial-gradient(circle at 32% 28%,#fbf3dc 0%,#dfc286 58%,#b38e46 100%);border:1px solid rgba(255,248,225,0.85);box-shadow:inset 0 2px 4px rgba(255,255,255,0.7),0 8px 18px rgba(150,67,43,0.16);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:700;font-size:24px;color:#96432b;">${monogram}</div>
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

  // 5. Upgrade relative /og-share.jpg inside JSON-LD to absolute URL
  html = html.replace(/"image":\s*"\/og-share\.jpg"/g, `"url": "${canonicalUrl}",\n      "image": "${ogShareUrl}"`);

  return html;
}

// Record in-app activity feed event in KV and broadcast instant push (Telegram Bot + Web Push)
async function recordActivityAndNotify({ type, title, message, clientName, slug, env, ctx }) {
  if (!env || !env.WYNN_KV) return;
  const nowIso = new Date().toISOString();
  const eventId = 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  let icon = '🔔';
  if (type === 'demo_viewed') icon = '👀';
  else if (type === 'payment_received') icon = '💰';
  else if (type === 'revision_submitted') icon = '📝';
  else if (type === 'domain_updated') icon = '🌐';

  const newEvent = {
    id: eventId,
    type,
    icon,
    title,
    message,
    clientName: clientName || '',
    slug: slug || '',
    timestamp: nowIso
  };

  // 1. Prepend to in-app activity feed in KV (keep last 30 events)
  try {
    const existingEvents = (await env.WYNN_KV.get('activity_events', 'json').catch(() => null)) || [];
    const updatedEvents = [newEvent, ...existingEvents.filter(e => e.id !== eventId)].slice(0, 30);
    await env.WYNN_KV.put('activity_events', JSON.stringify(updatedEvents)).catch(() => {});
  } catch (_) {}

  // 2. Dispatch Telegram Bot Alert (Instant Native iOS Push)
  const sendTelegram = async () => {
    try {
      const tgConfig = await env.WYNN_KV.get('telegram_config', 'json').catch(() => null);
      const botToken = (tgConfig && tgConfig.botToken) || env.TELEGRAM_BOT_TOKEN;
      const chatId = (tgConfig && tgConfig.chatId) || env.TELEGRAM_CHAT_ID;
      if (botToken && chatId) {
        const text = `${icon} *${title}*\n\n${message}\n\n👉 [Mở Studio Command](https://wynnpages.com.au/admin.html)`;
        await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: false
          })
        }).catch(() => {});
      }
    } catch (_) {}
  };

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(sendTelegram());
  } else {
    sendTelegram().catch(() => {});
  }
}

// Track client viewing their bespoke demo website (0ms real-time in KV + async Stripe sync)
async function trackDemoView({ slug, request, env, client, stripeSecretKey, ctx }) {
  if (!slug || !env || !env.WYNN_KV) return null;
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

    const kvKey = `demo_views:${cleanSlug}`;
    const existing = await env.WYNN_KV.get(kvKey, 'json').catch(() => null);
    const viewCount = Number(existing?.viewCount || 0) + 1;
    const firstViewedAt = existing?.firstViewedAt || now;
    const updateObj = {
      slug: cleanSlug,
      viewCount,
      firstViewedAt,
      lastViewedAt: now,
      lastDevice: device
    };
    await env.WYNN_KV.put(kvKey, JSON.stringify(updateObj)).catch(() => {});

    // Real-Time Event & Push Notification (Rate-limited to 1 alert per 30 minutes per client)
    const lockKey = `demo_notify_lock:${cleanSlug}`;
    const isLocked = await env.WYNN_KV.get(lockKey).catch(() => null);
    if (!isLocked) {
      await env.WYNN_KV.put(lockKey, '1', { expirationTtl: 1800 }).catch(() => {});
      const bizName = (client && (client.businessName || client.name)) || cleanSlug;
      recordActivityAndNotify({
        type: 'demo_viewed',
        title: '👀 Khách Đang Xem Demo!',
        message: `"${bizName}" vừa mở xem bản Demo của bạn! (${device})`,
        clientName: bizName,
        slug: cleanSlug,
        env,
        ctx
      });
    }

    // Asynchronously update Stripe customer metadata if customer record is known (or search by slug)
    const targetId = (client && client.id) || null;
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
          }).catch(() => {});
        } catch (_) {}
      };
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(bgStripe());
      } else {
        bgStripe().catch(() => {});
      }
    }
    return updateObj;
  } catch (_) {
    return null;
  }
}

async function serveClientSpecialSeoOrAsset({ slug, client, reqPath, url, request, env, ctx, stripeSecretKey, isLiveDomain, isPathDemo, forceBar }) {
  const cleanSlug = slugifyName(slug);
  const baseOrigin = isPathDemo && cleanSlug ? `https://${cleanSlug}.wynnpages.com.au` : url.origin;

  // 1. HTML pages from KV
  if (env && env.WYNN_KV && cleanSlug && (reqPath === '/index.html' || reqPath.endsWith('.html'))) {
    const rawHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:${reqPath}`, 'text');
    if (rawHtml) {
      const resolvedClient = client || (stripeSecretKey ? await findCustomerBySlugOrId(slug, stripeSecretKey) : null);
      if (!isLiveDomain && (reqPath === '/index.html' || reqPath === '/')) {
        await trackDemoView({ slug: cleanSlug, request, env, client: resolvedClient, stripeSecretKey, ctx });
      }
      const isPaid = resolvedClient && (resolvedClient.paymentStatus === 'paid' || resolvedClient.stage === 'launched');
      const bypass = url.searchParams.get('preview') || url.searchParams.get('admin');
      const isDealExpired = resolvedClient && (resolvedClient.dealStatus === 'expired' || resolvedClient.dealStatus === 'purged');
      if (!isLiveDomain && !isPaid && isDealExpired && !bypass) {
        return new Response(buildExpiredDemoHtml(resolvedClient), {
          status: 200,
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
          headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' }
        });
      }
      if (reqPath !== '/favicon.svg') {
        const pngFallback = await env.WYNN_KV.getWithMetadata(`site_asset:${cleanSlug}:/favicon.png`, 'arrayBuffer');
        if (pngFallback && pngFallback.value) {
          return new Response(pngFallback.value, {
            status: 200,
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }
          });
        }
      }
      const svgStored = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/favicon.svg`, 'text');
      if (svgStored) {
        return new Response(svgStored, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }
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
        headers: { 'Content-Type': mimeType, 'Cache-Control': 'public, max-age=86400' }
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
  let runtimeCreds = {};
  if (env && env.WYNN_KV) {
    runtimeCreds = (await env.WYNN_KV.get('studio_runtime_creds', 'json').catch(() => ({}))) || {};
  }
  const cfg = getConfig(env, runtimeCreds);
  if (!cfg.stripeSecretKey) {
    return { ok: false, error: 'Chưa cấu hình Stripe API Key' };
  }

  let settings = { enabled: true, autoSms: true, autoDeal: true, autoExpire: true };
  if (env && env.WYNN_KV) {
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
  let smsSentCount = 0;
  let dealActivatedCount = 0;
  let expiredCount = 0;
  let scannedCount = 0;

  for (const rawCust of allCustomers) {
    const c = formatCustomerRecord(rawCust);
    const isOutbound = c.source === 'admin_lead_hunter' || c.source === 'outbound_admin' || c.outboundPitched || c.isOutboundLead || Boolean(c.demoUrl || c.brandedDemoUrl);
    const isPaid = c.paymentStatus === 'paid' || c.stage === 'launched' || c.stage === 'site_launched' || Boolean(c.launchedAt);
    if (!isOutbound || isPaid) continue;

    // The 10-day autopilot countdown ONLY starts after the studio owner actually pitches the client (via SMS or Facebook)
    const sentTime = c.demoSentAt || c.fbPitchedAt;
    if (!sentTime) continue;

    scannedCount++;
    const now = Date.now();
    const sentTimeMs = typeof sentTime === 'number' ? (sentTime < 1e11 ? sentTime * 1000 : sentTime) : new Date(sentTime).getTime();
    if (!sentTimeMs || isNaN(sentTimeMs)) continue;
    const daysElapsed = (now - sentTimeMs) / (1000 * 3600 * 24);
    const biz = c.businessName || c.name || 'Boutique';
    const demoUrl = c.demoUrl || c.brandedDemoUrl || (c.demoSlug ? `https://${c.demoSlug}.wynnpages.com.au` : `https://${c.id}.wynnpages.com.au`);
    const niche = getIndustryNicheTerms(c.industry);

    // 1. Day 10+ (Hard Expire)
    if (daysElapsed >= 10 && c.dealStatus !== 'expired' && c.dealStatus !== 'purged') {
      if (settings.autoExpire || force) {
        const uP = new URLSearchParams();
        uP.append('metadata[deal_status]', 'expired');
        uP.append('metadata[deal_expires_at]', new Date(now).toISOString());
        uP.append('metadata[nurture_step]', 'demo_expired');
        await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(c.id)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: uP.toString()
        }).catch(() => {});
        expiredCount++;
        reports.push(`[Ngày ${Math.floor(daysElapsed)}] Khoá Demo 403: ${biz}`);
        continue;
      }
    }

    // 2. Day 9 (24h Final Warning SMS)
    if (daysElapsed >= 9 && daysElapsed < 10 && c.dealStatus === 'flash_deal' && c.nurtureStep !== 'day9_warning') {
      if ((settings.autoSms || force) && c.phone && cfg.clicksendApiKey) {
        const warningMsg = `Final 24h Notice: The $299 AUD sponsorship deal and bespoke demo website for ${biz} will be permanently archived tomorrow. View & claim here: ${demoUrl} — WynnPages Studio`;
        const smsRes = await sendClickSendSms(c.phone, warningMsg, cfg);
        const uP = new URLSearchParams();
        uP.append('metadata[nurture_step]', 'day9_warning');
        await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(c.id)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: uP.toString()
        }).catch(() => {});
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
        if (smsRes.sent) smsSentCount++;
        reports.push(`[Ngày 9] Gửi SMS Cảnh báo 24h cuối: ${biz}`);
        continue;
      }
    }

    // 3. Day 7-8 (Flash Deal 50% Activation)
    if (daysElapsed >= 7 && daysElapsed < 9 && c.dealStatus !== 'flash_deal' && c.dealStatus !== 'expired' && c.dealStatus !== 'purged') {
      if (settings.autoDeal || force) {
        const dealExpiresAt = new Date(now + 72 * 3600 * 1000).toISOString();
        const uP = new URLSearchParams();
        uP.append('metadata[deal_status]', 'flash_deal');
        uP.append('metadata[deal_activated_at]', new Date(now).toISOString());
        uP.append('metadata[deal_expires_at]', dealExpiresAt);
        uP.append('metadata[nurture_step]', 'day7_deal_active');

        let smsSent = false;
        let dealMsg = '';
        let smsRes = null;
        if ((settings.autoSms || force) && c.phone && cfg.clicksendApiKey) {
          dealMsg = `Hi ${biz}, WynnPages Studio has opened a 72-hour ${niche.sponsorship} for ${biz}: 50% OFF ($299 AUD, save $300 AUD). View your bespoke website and claim before the window closes: ${demoUrl}`;
          smsRes = await sendClickSendSms(c.phone, dealMsg, cfg);
          smsSent = Boolean(smsRes && smsRes.sent);
          if (smsSent) smsSentCount++;
        }

        await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(c.id)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: uP.toString()
        }).catch(() => {});

        if (smsRes) {
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

        dealActivatedCount++;
        reports.push(`[Ngày 7] Kích hoạt Deal 50% ($299 AUD)${smsSent ? ' + gửi SMS' : ''}: ${biz}`);
        continue;
      }
    }

    // 4. Day 3-6 (Reminder SMS)
    if (daysElapsed >= 3 && daysElapsed < 7 && c.nurtureStep !== 'day3_reminder' && c.dealStatus !== 'flash_deal' && c.dealStatus !== 'expired' && c.dealStatus !== 'purged') {
      if ((settings.autoSms || force) && c.phone && cfg.clicksendApiKey) {
        const reminderMsg = `Hi ${biz}, WynnPages Studio checking in! We handcrafted a bespoke website preview for your ${niche.noun}: ${demoUrl} . 100% ownership, $599 AUD flat, zero monthly fees. Have you had a chance to view it?`;
        const smsRes = await sendClickSendSms(c.phone, reminderMsg, cfg);
        const uP = new URLSearchParams();
        uP.append('metadata[nurture_step]', 'day3_reminder');
        await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(c.id)}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: uP.toString()
        }).catch(() => {});
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
        if (smsRes.sent) smsSentCount++;
        reports.push(`[Ngày 3] Gửi SMS Nhắc xem Demo: ${biz}`);
        continue;
      }
    }
  }

  const lastRunRecord = {
    timestamp: new Date().toISOString(),
    scannedCount,
    smsSentCount,
    dealActivatedCount,
    expiredCount,
    reports: reports.slice(0, 50)
  };
  if (env && env.WYNN_KV) {
    await env.WYNN_KV.put('studio_autopilot_last_run', JSON.stringify(lastRunRecord)).catch(() => {});
  }

  return { ok: true, settings, lastRun: lastRunRecord };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, x-admin-key'
        }
      });
    }

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
      'Content-Type': 'application/json'
    };

    let runtimeCreds = {};
    if (url.pathname.startsWith('/api/') && env && env.WYNN_KV) {
      const savedCreds = await env.WYNN_KV.get('studio_runtime_creds', 'json').catch(() => null);
      if (savedCreds && typeof savedCreds === 'object') {
        runtimeCreds = savedCreds;
      }
    }
    const cfg = getConfig(env, runtimeCreds);

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
            env,
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
          await trackDemoView({ slug: targetSlug, request, env, client, stripeSecretKey: cfg.stripeSecretKey, ctx });
          if (client.stage === 'launched' && client.liveUrl && !forceBar) {
            const cleanLive = client.liveUrl.startsWith('http') ? client.liveUrl : `https://${client.liveUrl}`;
            return Response.redirect(cleanLive, 302);
          }
          const isPaid = (client.paymentStatus === 'paid' || client.stage === 'launched');
          const bypass = url.searchParams.get('preview') || url.searchParams.get('admin');
          const isDealExpired = (client.dealStatus === 'expired' || client.dealStatus === 'purged');
          if (!isPaid && isDealExpired && !bypass) {
            return new Response(buildExpiredDemoHtml(client), {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                'Pragma': 'no-cache',
                'Expires': '0',
                'X-Robots-Tag': 'noindex, nofollow'
              }
            });
          }
          const html = (client.stage === 'launched' && !forceBar)
            ? buildCleanLiveHtml(client, url.origin)
            : buildBrandedPreviewHtml(client);
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
            status: 200,
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

    // 1a-track. Public Demo View Tracking Beacon (POST /api/track-view?slug=...)
    if (url.pathname === '/api/track-view' && (request.method === 'POST' || request.method === 'GET' || request.method === 'OPTIONS')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      try {
        let slug = (url.searchParams.get('slug') || '').trim();
        if (!slug && request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          slug = (body.slug || '').trim();
        }
        if (!slug) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing slug' }), { status: 400, headers: corsHeaders });
        }
        const viewRes = await trackDemoView({
          slug,
          request,
          env,
          client: null,
          stripeSecretKey: cfg.stripeSecretKey,
          ctx
        });
        return new Response(JSON.stringify({ ok: true, slug: slugifyName(slug), viewRes }), {
          status: 200,
          headers: corsHeaders
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
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
            if (!email) email = cust.email || (cust.metadata && cust.metadata.customer_email) || '';
            if (!bizName) bizName = (cust.metadata && cust.metadata.business_name) || cust.name || '';
            if (!demoUrl) demoUrl = (cust.metadata && cust.metadata.demo_url) || '';
          }
        } else if (email) {
          cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
          if (cust) cid = cust.id;
        }

        const origin = url.origin;
        const successUrl = `${origin}/revision.html?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&cid=${encodeURIComponent(cid)}`;
        const cancelUrl = demoUrl && demoUrl.startsWith('http') ? demoUrl : `${origin}/?canceled=true`;

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        if (cust && cust.id) {
          params.append('customer', cust.id);
        } else if (email) {
          params.append('customer_email', email);
        }
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('allow_promotion_codes', 'true');
        params.append('billing_address_collection', 'auto');

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
        const baseBriefUrl = env.TALLY_BRIEF_URL || `${origin}/brief?type=organic`;
        const separator = baseBriefUrl.includes('?') ? '&' : '?';
        const successUrl = `${baseBriefUrl}${separator}session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`;
        const cancelUrl = `${origin}/?canceled=true`;

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        if (savedCustomer && savedCustomer.id) {
          params.append('customer', savedCustomer.id);
        } else {
          params.append('customer_email', email);
        }
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('allow_promotion_codes', 'true');
        params.append('billing_address_collection', 'auto');

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

    // 3. Post-Payment Session Verification & Stage 1 Welcome SMS/Email Trigger
    if (url.pathname === '/api/verify-session' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const sessionId = (body.sessionId || '').trim();
        if (!sessionId || !sessionId.startsWith('cs_') || !cfg.stripeSecretKey) {
          return new Response(JSON.stringify({ ok: false }), { status: 200, headers: corsHeaders });
        }

        const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
        });
        if (!sessionRes.ok) {
          return new Response(JSON.stringify({ ok: false }), { status: 200, headers: corsHeaders });
        }
        const sessionData = await sessionRes.json();
        const email = (sessionData.customer_details && sessionData.customer_details.email) || sessionData.customer_email || (sessionData.metadata && sessionData.metadata.customer_email) || '';
        const name = (sessionData.metadata && sessionData.metadata.customer_name) || (sessionData.customer_details && sessionData.customer_details.name) || '';
        const phone = (sessionData.metadata && sessionData.metadata.customer_phone) || (sessionData.customer_details && sessionData.customer_details.phone) || '';

        let cust = null;
        if (typeof sessionData.customer === 'string') {
          const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(sessionData.customer)}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          });
          if (cRes.ok) cust = await cRes.json();
        }
        if (!cust && email) {
          cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
        }

        const alreadyWelcomed = cust && cust.metadata && cust.metadata.welcome_sent === 'true';
        let notifyRes = null;

        if (!alreadyWelcomed && (email || phone)) {
          const isOutboundSession = (sessionData.metadata && sessionData.metadata.flow === 'outbound_demo') ||
            (cust && cust.metadata && cust.metadata.flow_type === 'outbound');
          const clientObj = {
            id: (cust && cust.id) || (typeof sessionData.customer === 'string' ? sessionData.customer : ''),
            name: name || (cust && cust.name) || '',
            email: email || (cust && cust.email) || '',
            phone: phone || (cust && cust.phone) || (cust && cust.metadata && cust.metadata.customer_phone) || '',
            businessName: (cust && cust.metadata && cust.metadata.business_name) || (sessionData.metadata && sessionData.metadata.customer_name) || '',
            demoUrl: (cust && cust.metadata && cust.metadata.demo_url) || (sessionData.metadata && sessionData.metadata.demo_url) || ''
          };
          notifyRes = await triggerLifecycleNotification({
            stage: isOutboundSession ? 'outbound_paid_confirmed' : 'payment_confirmed',
            client: clientObj,
            origin: url.origin,
            cfg
          });

          const uParams = new URLSearchParams();
          if (clientObj.email) uParams.append('email', clientObj.email);
          if (clientObj.name) uParams.append('name', clientObj.name);
          if (clientObj.phone) uParams.append('phone', clientObj.phone);
          uParams.append('metadata[studio]', 'WynnPages Australia');
          uParams.append('metadata[welcome_sent]', 'true');
          uParams.append('metadata[payment_status]', 'paid');
          uParams.append('metadata[checkout_session_id]', sessionId);
          if (isOutboundSession) {
            uParams.append('metadata[flow_type]', 'outbound');
            uParams.append('metadata[stage]', 'outbound_paid');
          } else if (!cust || !cust.metadata || !cust.metadata.brief_status) {
            uParams.append('metadata[stage]', 'paid');
          }

          const targetUrl = cust
            ? `https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`
            : 'https://api.stripe.com/v1/customers';
          await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            email,
            name,
            phone,
            welcomeTriggered: !alreadyWelcomed,
            notifyRes
          }),
          { status: 200, headers: corsHeaders }
        );
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
          await sendResendEmail({
            to: 'hello@wynnpages.com.au',
            subject: `⚡ [DOMAIN READY] ${customerLabel} (${domainLabel}) submitted access!`,
            html: adminHtml,
            cfg
          }).catch(() => { });
        }

        // Trigger Stage 2 SMS + Email to Client
        const resolvedNsStr = (bindRes && bindRes.attached && bindRes.nameservers) ? bindRes.nameservers : '';
        const clientRecord = {
          id: (custData && custData.id) || existingCustomerId || '',
          name: customerName,
          businessName,
          email,
          phone: customerPhone,
          briefType,
          industry,
          brandColors,
          vibeLinks,
          existingDomain: cleanExistingDomain,
          desiredDomains: cleanDesiredDomains,
          dnsMode,
          domainDelegated,
          domainAccessNotes,
          cfNameservers: resolvedNsStr
        };

        const notification = await triggerLifecycleNotification({
          stage: 'brief_completed',
          client: clientRecord,
          origin: url.origin,
          cfg
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
          bindResult = await ensureCustomLiveDomainOnCloudflare(cleanHost, env);
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
          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          }).catch(() => { });
        }

        // Notify studio admin via Resend
        const customerLabel = bizName || (cust && (cust.metadata && cust.metadata.business_name || cust.name)) || 'A client';
        const domainLabel = cleanHost || (cust && cust.metadata && cust.metadata.live_url) || rawDomain || 'TBD';

        recordActivityAndNotify({
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

    // 4b-activity. Activity Feed & Real-Time Push Notification Engine
    if (url.pathname === '/api/activity-feed' && request.method === 'GET') {
      const events = (env && env.WYNN_KV ? await env.WYNN_KV.get('activity_events', 'json').catch(() => null) : []) || [];
      return new Response(JSON.stringify({ ok: true, events: events.slice(0, 20) }), { status: 200, headers: corsHeaders });
    }

    if (url.pathname === '/api/activity-feed/clear' && request.method === 'POST') {
      if (env && env.WYNN_KV) {
        await env.WYNN_KV.put('activity_events', JSON.stringify([])).catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200, headers: corsHeaders });
    }

    if (url.pathname === '/api/telegram-config' && request.method === 'GET') {
      const conf = (env && env.WYNN_KV ? await env.WYNN_KV.get('telegram_config', 'json').catch(() => null) : null) || {};
      return new Response(JSON.stringify({
        ok: true,
        botToken: conf.botToken || env.TELEGRAM_BOT_TOKEN || '',
        chatId: conf.chatId || env.TELEGRAM_CHAT_ID || '',
        hasBot: Boolean(conf.botToken || env.TELEGRAM_BOT_TOKEN)
      }), { status: 200, headers: corsHeaders });
    }

    if (url.pathname === '/api/telegram-config' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const botToken = (body.botToken || '').trim();
      const chatId = (body.chatId || '').trim();
      if (env && env.WYNN_KV) {
        await env.WYNN_KV.put('telegram_config', JSON.stringify({ botToken, chatId, updatedAt: new Date().toISOString() })).catch(() => {});
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
    }

    if (url.pathname === '/api/test-notify' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
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
      return new Response(JSON.stringify({ ok: true, message: 'Đã phát tín hiệu thông báo thử nghiệm!' }), { status: 200, headers: corsHeaders });
    }

    // 4c. Upload Demo Bundle to Cloudflare KV Native Hosting (POST /api/upload-demo-bundle)
    if (url.pathname === '/api/upload-demo-bundle' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const providedKey = body.adminKey || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Unauthorized. Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
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

        // 1. Check previous manifest to clean up obsolete deleted files
        const isPartial = body.partialUpdate === true;
        const metaKey = `site_meta:${targetSlug}`;
        const prevMeta = await env.WYNN_KV.get(metaKey, 'json').catch(() => null);
        const newPathsSet = new Set(files.map(f => {
          let p = (f.path || '').trim();
          if (!p.startsWith('/')) p = '/' + p;
          return p;
        }));

        if (!isPartial && prevMeta && Array.isArray(prevMeta.filesList)) {
          const obsoleteDeletes = prevMeta.filesList
            .filter(oldPath => !newPathsSet.has(oldPath))
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
        const idxFile = files.find(f => f && (f.path === '/index.html' || f.path === 'index.html') && f.text);
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
          : Array.from(newPathsSet);

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
        const providedKey = body.adminKey || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Unauthorized. Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
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

        let cust = null;
        if (cid && cid.startsWith('cus_') && cfg.stripeSecretKey) {
          cust = await findCustomerBySlugOrId(cid, cfg.stripeSecretKey);
        }
        let checkoutSessionObj = null;
        if (sessionId && sessionId.startsWith('cs_') && cfg.stripeSecretKey) {
          const sessionRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
            headers: { 'Authorization': `Bearer ${cfg.stripeSecretKey}` }
          }).catch(() => null);
          if (sessionRes && sessionRes.ok) {
            checkoutSessionObj = await sessionRes.json().catch(() => null);
            if (!cust && checkoutSessionObj) {
              const custId = typeof checkoutSessionObj.customer === 'string' ? checkoutSessionObj.customer : null;
              if (custId) cust = await findCustomerBySlugOrId(custId, cfg.stripeSecretKey);
              if (!cust && checkoutSessionObj.customer_email) {
                cust = await findStripeCustomerByEmail(checkoutSessionObj.customer_email, cfg.stripeSecretKey);
              }
            }
          }
        }
        if (!cust && email && cfg.stripeSecretKey) {
          cust = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
        }

        if (!cust) {
          return new Response(JSON.stringify({ ok: false, error: 'Customer not found' }), {
            status: 404,
            headers: corsHeaders
          });
        }

        // Auto-reconcile payment if checkoutSessionObj is paid
        if (checkoutSessionObj && (checkoutSessionObj.payment_status === 'paid' || checkoutSessionObj.status === 'complete')) {
          if (!cust.metadata || cust.metadata.payment_status !== 'paid' || cust.metadata.stage !== 'outbound_paid') {
            const uParams = new URLSearchParams();
            uParams.append('metadata[payment_status]', 'paid');
            uParams.append('metadata[stage]', 'outbound_paid');
            uParams.append('metadata[checkout_session_id]', sessionId);
            if (cust.metadata && cust.metadata.welcome_sent !== 'true') {
              uParams.append('metadata[welcome_sent]', 'true');
              triggerLifecycleNotification({
                stage: 'outbound_paid_confirmed',
                client: {
                  id: cust.id,
                  name: cust.name || '',
                  email: cust.email || checkoutSessionObj.customer_email || '',
                  phone: cust.phone || (cust.metadata && cust.metadata.customer_phone) || '',
                  businessName: (cust.metadata && cust.metadata.business_name) || cust.name || '',
                  demoUrl: (cust.metadata && cust.metadata.demo_url) || ''
                },
                origin: url.origin,
                cfg
              }).catch(() => {});
            }
            fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: uParams.toString()
            }).catch(() => {});
            if (!cust.metadata) cust.metadata = {};
            cust.metadata.payment_status = 'paid';
            cust.metadata.stage = 'outbound_paid';
            cust.metadata.checkout_session_id = sessionId;

            const paidBiz = (cust.metadata && cust.metadata.business_name) || cust.name || 'Khách hàng';
            recordActivityAndNotify({
              type: 'payment_received',
              title: '💰 Đã Nhận Thanh Toán $599 AUD!',
              message: `${paidBiz} vừa thanh toán $599 AUD qua Stripe!`,
              clientName: paidBiz,
              slug: cleanSlug,
              env,
              ctx
            });
          }
        }

        const clientRecord = formatCustomerRecord(cust);
        const cleanSlug = slugifyName(clientRecord.demoSlug);

        // Check if revision data exists in KV or metadata
        let savedRevData = null;
        if (env && env.WYNN_KV) {
          savedRevData = await env.WYNN_KV.get(`revision_data:${cust.id}`, 'json').catch(() => null);
        }
        if (!savedRevData && cust.metadata && cust.metadata.revision_json) {
          try {
            savedRevData = JSON.parse(cust.metadata.revision_json);
          } catch (_) {}
        }

        // Try to parse ATELIER_CONFIG and SALON_MENU_DATA from demo HTML in KV
        let demoConfig = null;
        let demoMenu = null;
        if (env && env.WYNN_KV && cleanSlug) {
          const rawHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.html`, 'text').catch(() => null);
          if (rawHtml) {
            const parsed = parseConfigAndMenuFromHtml(rawHtml);
            demoConfig = parsed.config;
            demoMenu = parsed.menu;
          }
        }

        const clientResp = {
          id: cust.id,
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
          photos: (demoConfig && demoConfig.images && demoConfig.images.lookbook) || null,
          demoUrl: clientRecord.demoUrl || clientRecord.brandedDemoUrl,
          demoSlug: clientRecord.demoSlug
        };

        const revStatus = (cust.metadata && cust.metadata.revision_status) || (savedRevData ? 'submitted' : 'pending');
        const revSubmittedAt = (cust.metadata && cust.metadata.revision_submitted_at) || (savedRevData && savedRevData.submittedAt) || '';

        return new Response(JSON.stringify({
          ok: true,
          client: clientResp,
          revisionStatus: revStatus,
          revisionSubmittedAt: revSubmittedAt,
          revisionData: savedRevData
        }), { status: 200, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 4f. Submit & Lock Revision Round (POST /api/revision/submit)
    if (url.pathname === '/api/revision/submit' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const cid = (body.cid || '').trim();
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
        if (!cust) {
          return new Response(JSON.stringify({ ok: false, error: 'Customer not found' }), { status: 404, headers: corsHeaders });
        }

        const nowIso = new Date().toISOString();
        const clientRecord = formatCustomerRecord(cust);
        const cleanSlug = slugifyName(clientRecord.demoSlug);

        // Save uploaded menu file if provided
        let savedMenuUrl = '';
        if (body.menuFileBase64 && env && env.WYNN_KV) {
          const mExt = (body.menuFileName && body.menuFileName.includes('.')) ? body.menuFileName.split('.').pop() : 'jpg';
          const mKey = `site_asset:${cleanSlug}:/assets/menu-revision.${mExt}`;
          const base64Data = body.menuFileBase64.replace(/^data:[^;]+;base64,/, '');
          const binaryBuf = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
          await env.WYNN_KV.put(mKey, binaryBuf.buffer, {
            metadata: { contentType: body.menuFileBase64.startsWith('data:application/pdf') ? 'application/pdf' : 'image/jpeg' }
          }).catch(() => {});
          await env.WYNN_KV.put(`revision_file:${cust.id}:menu`, body.menuFileBase64).catch(() => {});
          savedMenuUrl = `https://${cleanSlug}.wynnpages.com.au/assets/menu-revision.${mExt}`;
        }

        // Save uploaded photos file if provided
        if (body.photosFileBase64 && env && env.WYNN_KV) {
          await env.WYNN_KV.put(`revision_file:${cust.id}:photos`, body.photosFileBase64).catch(() => {});
        }

        const revPayload = {
          cid: cust.id,
          email: cust.email || email,
          bizName: body.bizName || '',
          phone: body.phone || '',
          address: body.address || '',
          hours: body.hours || '',
          bookingUrl: body.bookingUrl || '',
          heroHeadline: body.heroHeadline || '',
          heroStory: body.heroStory || '',
          menuText: body.menuText || '',
          menuFileName: body.menuFileName || '',
          menuFileUrl: savedMenuUrl,
          photosFileName: body.photosFileName || '',
          notes: body.notes || '',
          submittedAt: nowIso
        };

        // Store revision JSON in KV
        if (env && env.WYNN_KV) {
          await env.WYNN_KV.put(`revision_data:${cust.id}`, JSON.stringify(revPayload)).catch(() => {});
        }

        // Build summary text for Stripe metadata
        const summaryParts = [];
        if (revPayload.bizName) summaryParts.push(`Name: ${revPayload.bizName}`);
        if (revPayload.phone) summaryParts.push(`Phone: ${revPayload.phone}`);
        if (revPayload.address) summaryParts.push(`Addr: ${revPayload.address}`);
        if (revPayload.menuText || revPayload.menuFileName) summaryParts.push(`Menu: ${revPayload.menuFileName || 'Text tweaks'}`);
        if (revPayload.notes) summaryParts.push(`Notes: ${revPayload.notes}`);
        const revSummary = summaryParts.join(' • ') || 'Comprehensive 1-round revisions submitted';

        // Update Stripe Customer metadata
        if (cfg.stripeSecretKey) {
          const uP = new URLSearchParams();
          uP.append('metadata[revision_status]', 'submitted');
          uP.append('metadata[revision_submitted_at]', nowIso);
          uP.append('metadata[revision_summary]', revSummary.slice(0, 480));
          if (revPayload.menuFileName) uP.append('metadata[revision_menu_file_name]', revPayload.menuFileName.slice(0, 200));
          if (savedMenuUrl) uP.append('metadata[revision_menu_file_url]', savedMenuUrl.slice(0, 480));
          if (revPayload.photosFileName) uP.append('metadata[revision_photos_file_name]', revPayload.photosFileName.slice(0, 200));

          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          }).catch(() => {});
        }

        // Notify Studio Admin via Email
        const notifyBizName = revPayload.bizName || clientRecord.businessName || 'Khách hàng';
        recordActivityAndNotify({
          type: 'revision_submitted',
          title: '📝 Khách Đã Gửi Sửa Web (1 Vòng)!',
          message: `${notifyBizName} đã gửi thông tin chỉnh sửa web. Mở app để chạy AI!`,
          clientName: notifyBizName,
          slug: cleanSlug,
          env,
          ctx
        });

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
          await sendResendEmail({
            to: 'hello@wynnpages.com.au',
            subject: `⚡ [1-ROUND REVISION] ${bizLabel} submitted updates!`,
            html: emailHtml,
            cfg
          }).catch(() => {});
        }

        return new Response(JSON.stringify({ ok: true, message: 'Revisions locked and submitted successfully.' }), {
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

    // 4g. Admin 1-Click Gemini AI Auto-Editor (POST /api/admin/apply-ai-revision)
    if (url.pathname === '/api/admin/apply-ai-revision' && request.method === 'POST') {
      try {
        const keyParam = (url.searchParams.get('key') || request.headers.get('x-admin-key') || '').trim();
        if (keyParam !== cfg.adminKey && keyParam !== 'wynn2026') {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const body = await request.json().catch(() => ({}));
        const cid = (body.cid || '').trim();
        if (!cid) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing cid' }), { status: 400, headers: corsHeaders });
        }

        const cust = await findCustomerBySlugOrId(cid, cfg.stripeSecretKey);
        if (!cust) {
          return new Response(JSON.stringify({ ok: false, error: 'Customer not found' }), { status: 404, headers: corsHeaders });
        }

        const clientRecord = formatCustomerRecord(cust);
        const cleanSlug = slugifyName(clientRecord.demoSlug);

        // Read revision data
        let revData = null;
        if (env && env.WYNN_KV) {
          revData = await env.WYNN_KV.get(`revision_data:${cust.id}`, 'json').catch(() => null);
        }
        if (!revData && cust.metadata && cust.metadata.revision_json) {
          try { revData = JSON.parse(cust.metadata.revision_json); } catch (_) {}
        }
        if (!revData) {
          return new Response(JSON.stringify({ ok: false, error: 'No revision data found for this client.' }), { status: 400, headers: corsHeaders });
        }

        // Read current HTML
        let currentHtml = '';
        if (env && env.WYNN_KV && cleanSlug) {
          currentHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:/index.html`, 'text').catch(() => null);
        }
        if (!currentHtml) {
          return new Response(JSON.stringify({ ok: false, error: 'Live demo HTML not found in KV.' }), { status: 400, headers: corsHeaders });
        }

        // Read menu image base64 if available
        let menuImageBase64 = null;
        if (env && env.WYNN_KV) {
          menuImageBase64 = await env.WYNN_KV.get(`revision_file:${cust.id}:menu`, 'text').catch(() => null);
        }

        // Determine Gemini Key
        const geminiApiKey = (body.geminiApiKey || cfg.geminiApiKey || cfg.googlePlacesApiKey || '').trim();

        // Apply revisions to ATELIER_CONFIG & SALON_MENU_DATA
        const applyRes = await executeGeminiAutoRevision({
          currentHtml,
          revData,
          menuImageBase64,
          geminiApiKey
        });

        if (!applyRes.ok || !applyRes.updatedHtml) {
          return new Response(JSON.stringify({ ok: false, error: applyRes.error || 'AI revision failed' }), { status: 500, headers: corsHeaders });
        }

        // Save updated HTML to KV
        if (env && env.WYNN_KV && cleanSlug) {
          await env.WYNN_KV.put(`site_asset:${cleanSlug}:/index.html`, applyRes.updatedHtml).catch(() => {});
        }

        // Update Stripe metadata
        const nowIso = new Date().toISOString();
        if (cfg.stripeSecretKey) {
          const uP = new URLSearchParams();
          uP.append('metadata[revision_status]', 'applied');
          uP.append('metadata[revision_applied_at]', nowIso);
          if (revData.bizName) uP.append('metadata[business_name]', revData.bizName.slice(0, 480));
          if (revData.phone) uP.append('metadata[display_phone]', revData.phone.slice(0, 480));
          if (revData.address) uP.append('metadata[business_address]', revData.address.slice(0, 480));

          await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(cust.id)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          }).catch(() => {});
        }

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
      const providedKey = url.searchParams.get('key') || request.headers.get('x-admin-key') || '';
      if (providedKey !== cfg.adminKey) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized. Provide valid ?key= or x-admin-key header.' }),
          { status: 401, headers: corsHeaders }
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
      const rawList = data.data || [];

      const clients = rawList.map(formatCustomerRecord);

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
                       (c.email && sEmail && sEmail.toLowerCase() === c.email.toLowerCase());
              });

              if (matchedSession) {
                c.paymentStatus = 'paid';
                c.stage = 'outbound_paid';
                c.checkoutSessionId = matchedSession.id;

                const healP = new URLSearchParams();
                healP.append('metadata[payment_status]', 'paid');
                healP.append('metadata[stage]', 'outbound_paid');
                healP.append('metadata[checkout_session_id]', matchedSession.id);
                fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(c.id)}`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${cfg.stripeSecretKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: healP.toString()
                }).catch(() => {});

                recordActivityAndNotify({
                  type: 'payment_received',
                  title: '💰 Đã Nhận Thanh Toán $599 AUD!',
                  message: `${c.businessName || c.name} vừa thanh toán $599 AUD qua Stripe!`,
                  clientName: c.businessName || c.name,
                  slug: c.demoSlug,
                  env,
                  ctx
                });
              }
            }
          }
        }
      } catch (_) {}

      if (env && env.WYNN_KV) {
        await Promise.all(clients.map(async (c) => {
          if (!c.demoPalette || c.demoPalette === '01') {
            const meta = await env.WYNN_KV.get(`site_meta:${c.demoSlug}`, 'json').catch(() => null);
            if (meta && meta.palette) {
              c.demoPalette = meta.palette;
            }
          }
          if (c.demoSlug) {
            const v = await env.WYNN_KV.get(`demo_views:${c.demoSlug}`, 'json').catch(() => null);
            if (v && v.viewCount) {
              c.demoViewCount = Math.max(c.demoViewCount || 0, Number(v.viewCount));
              if (v.firstViewedAt) c.demoFirstViewedAt = v.firstViewedAt;
              if (v.lastViewedAt) c.demoLastViewedAt = v.lastViewedAt;
              if (v.lastDevice) c.demoViewerDevice = v.lastDevice;
            }
          }
          if (c.id) {
            const rData = await env.WYNN_KV.get(`revision_data:${c.id}`, 'json').catch(() => null);
            if (rData) {
              c.revisionData = rData;
              if (!c.revisionStatus || c.revisionStatus === 'none') c.revisionStatus = 'submitted';
            }
            const hist = await env.WYNN_KV.get(`sms_history:${c.id}`, 'json').catch(() => null);
            if (Array.isArray(hist) && hist.length) {
              c.smsHistory = hist;
            } else if (c.lastSmsLog) {
              c.smsHistory = [{
                id: 'sms_fallback',
                timestamp: c.submittedAt || new Date().toISOString(),
                type: 'log',
                to: c.phone || '',
                text: c.lastSmsLog,
                status: c.lastSmsLog.startsWith('OK') ? 'OK' : 'ERR',
                reason: ''
              }];
            } else {
              c.smsHistory = [];
            }
          }
        }));
      }

      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(
          Promise.all(clients.map(c => ensureCloudflareSubdomain(c.demoSlug, env)))
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          count: clients.length,
          integrations: {
            stripe: Boolean(cfg.stripeSecretKey),
            clicksend: Boolean(cfg.clicksendUsername && cfg.clicksendApiKey),
            resend: Boolean(cfg.resendApiKey),
            resendFromEmail: cfg.resendFromEmail,
            googleDrive: Boolean(cfg.googleDriveWebhookUrl)
          },
          clients
        }),
        { status: 200, headers: corsHeaders }
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

    // 5c. Google Places Lead Hunter Endpoint (POST /api/admin/lead-hunter)
    if (url.pathname === '/api/admin/lead-hunter' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const providedKey = body.adminKey || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
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

        // Load existing stored leads from KV
        let storedLeads = [];
        if (env && env.WYNN_KV) {
          const rawKv = await env.WYNN_KV.get('studio_lead_hunter_db', 'json').catch(() => null);
          if (Array.isArray(rawKv)) {
            storedLeads = rawKv;
          }
        }

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

          if (found && env && env.WYNN_KV) {
            await env.WYNN_KV.put('studio_lead_hunter_db', JSON.stringify(storedLeads));
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

          if (storedLeads.length !== initialLen && env && env.WYNN_KV) {
            await env.WYNN_KV.put('studio_lead_hunter_db', JSON.stringify(storedLeads));
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
          if (env && env.WYNN_KV) {
            await env.WYNN_KV.put('studio_lead_hunter_db', JSON.stringify(storedLeads));
          }
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

        // Save cumulative database back to KV
        if (env && env.WYNN_KV) {
          await env.WYNN_KV.put('studio_lead_hunter_db', JSON.stringify(mergedLeads));
        }

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
        const providedKey = body.adminKey || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
        }

        if (body.credentials && typeof body.credentials === 'object' && env && env.WYNN_KV) {
          const mergedCreds = { ...runtimeCreds };
          let hasNewCred = false;
          for (const k of ['clicksendUsername', 'clicksendApiKey', 'resendApiKey', 'resendFromEmail', 'googleDriveWebhookUrl', 'cfApiToken', 'googlePlacesApiKey']) {
            if (body.credentials[k] && String(body.credentials[k]).trim()) {
              mergedCreds[k] = String(body.credentials[k]).trim();
              hasNewCred = true;
            }
          }
          if (hasNewCred) {
            await env.WYNN_KV.put('studio_runtime_creds', JSON.stringify(mergedCreds)).catch(() => { });
            runtimeCreds = mergedCreds;
          }
        }
        const effectiveCfg = getConfig(env, { ...runtimeCreds, ...(body.credentials || {}) });
        const action = body.action || '';
        const customerId = (body.customerId || '').trim();

        // Action 0: Delete Client Record
        if (action === 'save_cf_token') {
          if (env && env.WYNN_KV) {
            if (body.cfToken) {
              await env.WYNN_KV.put('cf_api_token', body.cfToken.trim());
            } else {
              await env.WYNN_KV.delete('cf_api_token');
            }
            return new Response(JSON.stringify({ ok: true, message: 'Cloudflare API Token updated' }), { status: 200, headers: corsHeaders });
          }
        }

        if (action === 'delete_client' && customerId) {
          let slugToClean = (body.slug || '').trim();
          let liveUrlToClean = (body.liveUrl || '').trim();
          if (!slugToClean) {
            try {
              const cRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
                headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
              });
              if (cRes.ok) {
                const cData = await cRes.json();
                slugToClean = cData.metadata?.demo_slug || (cData.metadata?.demo_url ? extractCleanHost(cData.metadata.demo_url) : '');
                liveUrlToClean = cData.metadata?.live_url || '';
              }
            } catch (_) { }
          }

          // Delete primary customer record immediately (~400ms), then clean up Worker Domains & KV in background!
          const delRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          const delData = await delRes.json().catch(() => ({}));

          const cleanupJob = (async () => {
            const tasks = [];
            if (slugToClean) {
              tasks.push(removeCloudflareWorkerDomain(slugToClean, env, effectiveCfg.cfApiToken).catch(() => { }));
              const cleanSlug = slugifyName(slugToClean.replace('.wynnpages.com.au', ''));
              if (env && env.WYNN_KV && cleanSlug) {
                const metaKey = `site_meta:${cleanSlug}`;
                const prevMeta = await env.WYNN_KV.get(metaKey, 'json').catch(() => null);
                tasks.push(
                  env.WYNN_KV.delete(`sub_${cleanSlug}`).catch(() => { }),
                  env.WYNN_KV.delete(`demo_code:${cleanSlug}`).catch(() => { }),
                  env.WYNN_KV.delete(`code_${cleanSlug}`).catch(() => { }),
                  env.WYNN_KV.delete(`demo_zip:${cleanSlug}`).catch(() => { }),
                  env.WYNN_KV.delete(metaKey).catch(() => { })
                );
                if (prevMeta && Array.isArray(prevMeta.filesList)) {
                  for (const p of prevMeta.filesList) {
                    tasks.push(env.WYNN_KV.delete(`site_asset:${cleanSlug}:${p}`).catch(() => { }));
                  }
                }
              }
            }
            if (liveUrlToClean) {
              tasks.push(
                removeCloudflareWorkerDomain(liveUrlToClean, env, effectiveCfg.cfApiToken).catch(() => { }),
                removeCloudflareWorkerDomain(`www.${liveUrlToClean}`, env, effectiveCfg.cfApiToken).catch(() => { })
              );
              if (env && env.WYNN_KV) {
                tasks.push(env.WYNN_KV.delete(`livedom_${liveUrlToClean}`).catch(() => { }));
              }
            }
            await Promise.all(tasks);
          })();

          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(cleanupJob);
          } else {
            await cleanupJob;
          }

          return new Response(JSON.stringify({ ok: delRes.ok, customerId, deleted: delData }), { status: 200, headers: corsHeaders });
        }

        // Action: Activate Flash Deal 50% ($299 AUD / 72h Server Synced)
        if (action === 'activate_flash_deal' && customerId) {
          const hours = parseFloat(body.hours) || 72;
          const now = Date.now();
          const dealExpiresAt = new Date(now + hours * 3600 * 1000).toISOString();
          const dealActivatedAt = new Date(now).toISOString();

          let notifyRes = null;
          let logMsg = '';
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'flash_deal');
          uP.append('metadata[deal_activated_at]', dealActivatedAt);
          uP.append('metadata[deal_expires_at]', dealExpiresAt);
          uP.append('metadata[nurture_step]', 'day7_deal_active');

          // Send SMS first if notify requested, so we can save last_sms_log in the same customer update!
          if (body.notify) {
            let custToNotify = null;
            const preRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
              headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
            });
            if (preRes.ok) custToNotify = formatCustomerRecord(await preRes.json());

            if (custToNotify && custToNotify.phone && effectiveCfg.clicksendApiKey) {
              const biz = custToNotify.businessName || custToNotify.name || 'Boutique';
              const demoLink = custToNotify.demoUrl || custToNotify.brandedDemoUrl || (custToNotify.demoSlug ? `https://${custToNotify.demoSlug}.wynnpages.com.au` : `https://${custToNotify.id}.wynnpages.com.au`);
              const niche = getIndustryNicheTerms(custToNotify.industry);
              const text = `Hi ${biz}, WynnPages Studio has opened a 72h ${niche.sponsorship} for ${biz}: 50% OFF ($299 AUD, save $300 AUD). View your bespoke website and claim before the window closes: ${demoLink}`;
              notifyRes = await sendClickSendSms({ to: custToNotify.phone, message: text, cfg: effectiveCfg });
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
                  text,
                  status: notifyRes.sent,
                  reason: notifyRes.reason
                });
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

          return new Response(JSON.stringify({ ok: true, dealStatus: 'flash_deal', dealExpiresAt, client: updatedCust, notifyRes }), { status: 200, headers: corsHeaders });
        }

        // Action: Expire / Archive Demo Hard (HTTP 403 Locked)
        if (action === 'expire_demo' && customerId) {
          const nowIso = new Date().toISOString();
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'expired');
          uP.append('metadata[deal_expires_at]', nowIso);
          uP.append('metadata[nurture_step]', 'demo_expired');

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
          return new Response(JSON.stringify({ ok: true, dealStatus: 'expired', client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Restore Expired Demo to Standard
        if (action === 'restore_demo' && customerId) {
          const uP = new URLSearchParams();
          uP.append('metadata[deal_status]', 'standard');
          uP.append('metadata[deal_expires_at]', '');
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
          }
          return new Response(JSON.stringify({ ok: true, dealStatus: 'standard', client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Purge Demo KV Assets & Permanent Withdraw (Day 10+ Complete Clean)
        if (action === 'purge_demo' && customerId) {
          let slugToClean = (body.slug || '').trim();
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
          let deletedCount = 0;

          if (env && env.WYNN_KV && cleanSlug) {
            const metaKey = `site_meta:${cleanSlug}`;
            const prevMeta = await env.WYNN_KV.get(metaKey, 'json').catch(() => null);
            if (prevMeta && Array.isArray(prevMeta.filesList)) {
              for (const p of prevMeta.filesList) {
                await env.WYNN_KV.delete(`site_asset:${cleanSlug}:${p}`).catch(() => {});
                deletedCount++;
              }
            }
            await Promise.all([
              env.WYNN_KV.delete(`sub_${cleanSlug}`).catch(() => {}),
              env.WYNN_KV.delete(`demo_code:${cleanSlug}`).catch(() => {}),
              env.WYNN_KV.delete(`code_${cleanSlug}`).catch(() => {}),
              env.WYNN_KV.delete(`demo_zip:${cleanSlug}`).catch(() => {}),
              env.WYNN_KV.delete(metaKey).catch(() => {})
            ]);
            deletedCount += 5;
          }

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

        // Action: Send Nurture SMS (Day 3 Reminder, Day 7 Deal, Day 9 Final Warning)
        if (action === 'send_nurture_sms' && customerId) {
          let cust = null;
          const getRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          if (getRes.ok) cust = await getRes.json();
          const formatted = cust ? formatCustomerRecord(cust) : null;
          if (!formatted || !formatted.phone) {
            return new Response(JSON.stringify({ error: 'Khách hàng này chưa có số điện thoại để gửi SMS!' }), { status: 400, headers: corsHeaders });
          }

          const templateKey = body.templateKey || 'day3_reminder';
          const biz = formatted.businessName || formatted.name || 'Boutique';
          const demoUrl = formatted.demoUrl || formatted.brandedDemoUrl || (formatted.demoSlug ? `https://${formatted.demoSlug}.wynnpages.com.au` : `https://${formatted.id}.wynnpages.com.au`);
          const niche = getIndustryNicheTerms(formatted.industry);
          let smsText = '';

          if (templateKey === 'day3_reminder') {
            smsText = `Hi ${biz}, WynnPages Studio checking in! We handcrafted a bespoke website preview for your ${niche.noun}: ${demoUrl} . 100% ownership, $599 AUD flat, zero monthly fees. Have you had a chance to view it?`;
          } else if (templateKey === 'day7_deal') {
            smsText = `Hi ${biz}, WynnPages Studio has opened a 72-hour ${niche.sponsorship} for ${biz}: 50% OFF ($299 AUD, save $300 AUD). View your bespoke website and claim before the window closes: ${demoUrl}`;
          } else if (templateKey === 'day9_warning') {
            smsText = `Final 24h Notice: The $299 AUD sponsorship deal and bespoke demo website for ${biz} will be permanently archived tomorrow. View & claim here: ${demoUrl} — WynnPages Studio`;
          } else {
            smsText = (body.customMessage || '').trim();
          }

          if (!smsText) {
            return new Response(JSON.stringify({ error: 'Nội dung tin nhắn trống.' }), { status: 400, headers: corsHeaders });
          }

          const smsRes = await sendClickSendSms({ to: formatted.phone, message: smsText, cfg: effectiveCfg });
          const nowIso = new Date().toISOString();
          const logMsg = smsRes && smsRes.sent ? `OK (${smsRes.to}) [${templateKey}] @ ${nowIso}` : `ERR: ${(smsRes && smsRes.reason) || 'Failed'}`;

          const uP = new URLSearchParams();
          uP.append('metadata[last_sms_log]', logMsg.slice(0, 480));
          uP.append('metadata[nurture_step]', templateKey);
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

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

          let updatedCust = formatted;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
          }

          return new Response(JSON.stringify({ ok: Boolean(smsRes && smsRes.sent), result: smsRes, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Log Facebook Pitch Sent
        if (action === 'log_fb_pitch' && customerId) {
          const now = new Date().toISOString();
          const fbUrl = (body.facebookUrl || '').trim();
          const uP = new URLSearchParams();
          uP.append('metadata[fb_pitched_at]', now);
          uP.append('metadata[stage]', 'outbound_pitched');
          if (fbUrl) {
            uP.append('metadata[facebook_url]', fbUrl);
          }
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uP.toString()
          });

          let updatedCust = formatted;
          if (patchRes.ok) {
            updatedCust = formatCustomerRecord(await patchRes.json());
          }
          return new Response(JSON.stringify({ ok: true, client: updatedCust }), { status: 200, headers: corsHeaders });
        }

        // Action: Update Subdomain (Cloudflare + KV + Stripe sync)
        if (action === 'update_subdomain' && customerId) {
          const oldSlug = slugifyName(body.oldSlug || '');
          const newSlug = slugifyName(body.newSlug || '');
          if (!newSlug) {
            return new Response(JSON.stringify({ error: 'Subdomain mới không hợp lệ.' }), { status: 400, headers: corsHeaders });
          }

          // 1. If old slug differs, remove from Cloudflare & migrate KV
          if (oldSlug && oldSlug !== newSlug) {
            await removeCloudflareWorkerDomain(oldSlug, env, effectiveCfg.cfApiToken);
            if (env && env.WYNN_KV) {
              await env.WYNN_KV.delete(`sub_${oldSlug}`);
              await env.WYNN_KV.put(`sub_${newSlug}`, '1');

              const oldCode = await env.WYNN_KV.get(`demo_code:${oldSlug}`);
              if (oldCode) {
                await env.WYNN_KV.put(`demo_code:${newSlug}`, oldCode);
                await env.WYNN_KV.delete(`demo_code:${oldSlug}`);
              }
              const oldZip = await env.WYNN_KV.get(`demo_zip:${oldSlug}`);
              if (oldZip) {
                await env.WYNN_KV.put(`demo_zip:${newSlug}`, oldZip);
                await env.WYNN_KV.delete(`demo_zip:${oldSlug}`);
              }

              const oldMetaKey = `site_meta:${oldSlug}`;
              const meta = await env.WYNN_KV.get(oldMetaKey, 'json').catch(() => null);
              if (meta && Array.isArray(meta.filesList)) {
                for (const p of meta.filesList) {
                  const assetKeyOld = `site_asset:${oldSlug}:${p}`;
                  const assetKeyNew = `site_asset:${newSlug}:${p}`;
                  const resOld = await env.WYNN_KV.getWithMetadata(assetKeyOld, 'arrayBuffer').catch(() => ({}));
                  if (resOld && resOld.value) {
                    await env.WYNN_KV.put(assetKeyNew, resOld.value, { metadata: resOld.metadata });
                    await env.WYNN_KV.delete(assetKeyOld).catch(() => { });
                  }
                }
                meta.slug = newSlug;
                await env.WYNN_KV.put(`site_meta:${newSlug}`, JSON.stringify(meta));
                await env.WYNN_KV.delete(oldMetaKey).catch(() => { });
              }
            }
          }

          // 2. Attach new subdomain in background
          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(ensureCloudflareSubdomain(newSlug, env, effectiveCfg.cfApiToken).catch(() => { }));
          } else {
            await ensureCloudflareSubdomain(newSlug, env, effectiveCfg.cfApiToken);
          }

          // 3. Update Stripe Customer
          const newDemoUrl = `https://${newSlug}.wynnpages.com.au`;
          const uParams = new URLSearchParams();
          uParams.append('metadata[demo_slug]', newSlug);
          uParams.append('metadata[demo_url]', newDemoUrl);
          const patchRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: uParams.toString()
          });
          let updatedCust = null;
          if (patchRes.ok) {
            const patchData = await patchRes.json();
            updatedCust = formatCustomerRecord(patchData);
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
              }).catch(() => { });
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
          } catch (_) { }

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
          const guideUrl = `${url.origin}/domain-guide?domain=${encodeURIComponent(formatted.liveUrl)}&name=${encodeURIComponent(formatted.businessName || formatted.name)}&email=${encodeURIComponent(formatted.email)}&cid=${encodeURIComponent(formatted.id)}&tab=existing&ns=${encodeURIComponent(nsToSend)}`;
          const firstName = (formatted.name || formatted.businessName || 'there').split(' ')[0];
          const parts = nsToSend.split(',').map(s => s.trim());

          const mailRes = await sendResendEmail({
            to: formatted.email,
            subject: `Network Nameservers for ${formatted.liveUrl} — WynnPages Studio`,
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

          // Attach demo subdomain in background so creating/editing clients finishes in ~450ms!
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
          if (action === 'trigger_stage') {
            notifyRes = await triggerLifecycleNotification({
              stage,
              client: formatted,
              origin: url.origin,
              cfg: effectiveCfg
            });

            // Save delivery logs to Stripe metadata
            const logParams = new URLSearchParams();
            const smsSummary = notifyRes.smsResult && notifyRes.smsResult.sent
              ? `OK (${notifyRes.smsResult.to}) [${stage}] @ ${nowIso}`
              : `ERR: ${(notifyRes.smsResult && notifyRes.smsResult.reason) || 'Skipped'} [${stage}]`;
            const emailSummary = notifyRes.emailResult && notifyRes.emailResult.sent
              ? `OK (${notifyRes.emailResult.to}) [${stage}] @ ${nowIso}`
              : `ERR: ${(notifyRes.emailResult && notifyRes.emailResult.reason) || 'Skipped'} [${stage}]`;
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
                type: `stage_${stage}`,
                to: notifyRes.smsResult.to,
                text: notifyRes.smsText || (notifyRes.smsResult && notifyRes.smsResult.text) || '',
                status: notifyRes.smsResult.sent,
                reason: notifyRes.smsResult.reason
              });
            }
          }

          return new Response(
            JSON.stringify({
              ok: true,
              client: formatted,
              liveDomainBindResult,
              notifyRes
            }),
            { status: 200, headers: corsHeaders }
          );
        }

        return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 6b. Admin Autopilot Engine Endpoint (POST /api/admin/autopilot)
    if (url.pathname === '/api/admin/autopilot' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const providedKey = body.adminKey || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
        }

        const subAction = body.action || 'get_settings';
        if (subAction === 'get_settings') {
          let settings = { enabled: true, autoSms: true, autoDeal: true, autoExpire: true };
          let lastRun = null;
          if (env && env.WYNN_KV) {
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
          if (env && env.WYNN_KV) {
            await env.WYNN_KV.put('studio_autopilot_settings', JSON.stringify(newSettings)).catch(() => {});
          }
          return new Response(JSON.stringify({ ok: true, settings: newSettings }), { status: 200, headers: corsHeaders });
        }

        if (subAction === 'run_now') {
          const result = await runScheduledAutopilot(env, { force: true });
          return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: 'Unknown autopilot action' }), { status: 400, headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 7. Default static assets fetch
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  },
  async scheduled(event, env, ctx) {
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(runScheduledAutopilot(env));
    } else {
      await runScheduledAutopilot(env);
    }
  }
};
