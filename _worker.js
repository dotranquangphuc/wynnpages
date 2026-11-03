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
    adminNotifyPhone: overrides.adminNotifyPhone || env.ADMIN_NOTIFY_PHONE || ADMIN_NOTIFY_PHONE_FALLBACK || ''
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
  const demoUrl = client.demoUrl || `${origin}`;
  const organicBriefUrl = `${origin}/brief?type=organic&email=${encodeURIComponent(email)}`;
  const demoBriefUrl = `${origin}/brief?type=demo&email=${encodeURIComponent(email)}`;

  let smsText = '';
  let emailSubject = '';
  let emailHtml = '';

  if (stage === 'payment_confirmed') {
    smsText = `G'day ${firstName}! Your WynnPages 7-day build slot is locked in. Complete your quick 2-min studio brief here so we can start crafting your website: ${organicBriefUrl}`;
    emailSubject = `Your 7-Day Build Slot is Locked — Complete Your 2-Min Brief`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Payment Secured via Stripe',
      heading: `Your 7-Day Build Slot is Locked, ${firstName}.`,
      bodyHtml: `
        <p>Welcome to <strong>WynnPages</strong>! Your $599 AUD studio build slot is officially reserved.</p>
        <p>To get our lead artisan designer started on your custom website right away, please complete your quick 2-minute onboarding brief using the button below:</p>
      `,
      primaryCta: {
        label: 'Complete Your 2-Min Studio Brief',
        url: organicBriefUrl
      }
    });
  } else if (stage === 'brief_completed') {
    const domainInfo = client.existingDomain || client.desiredDomains || 'TBD';
    smsText = `Thanks ${firstName}! We've received your WynnPages brief. Our studio is firing up the code editor now—we'll text you as soon as your live demo is ready to preview!`;
    emailSubject = `Brief Received! We're Crafting Your WynnPages Website`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Studio Active • 7-Day Build Started',
      heading: `We are firing up the code editor, ${firstName}.`,
      bodyHtml: `
        <p>Thank you for completing your studio brief! We have logged all your specifications and started crafting your bespoke website.</p>
        <div style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:14px;padding:16px;margin:18px 0;font-size:13px;">
          <div><strong>Type:</strong> ${(client.briefType || 'organic').toUpperCase()}</div>
          ${client.industry ? `<div style="margin-top:6px;"><strong>Industry:</strong> ${client.industry}</div>` : ''}
          ${client.brandColors ? `<div style="margin-top:6px;"><strong>Brand Palette:</strong> ${client.brandColors}</div>` : ''}
          ${client.vibeLinks ? `<div style="margin-top:6px;"><strong>Reference Vibes:</strong> ${client.vibeLinks}</div>` : ''}
          <div style="margin-top:6px;"><strong>Domain:</strong> ${domainInfo}</div>
        </div>
        <p>We will send you a text message and email with your live interactive demo link as soon as it is ready for your review.</p>
      `,
      primaryCta: {
        label: 'Visit WynnPages Studio',
        url: origin
      }
    });
  } else if (stage === 'demo_ready') {
    smsText = `Great news ${firstName}! Your custom WynnPages website demo is ready to preview: ${demoUrl} — Once you've had a look, upload your high-res logo & menu here to finalise launch: ${demoBriefUrl}`;
    emailSubject = `Great News! Your Custom WynnPages Website Demo is Ready`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Custom Demo Ready for Review',
      heading: `Your custom website demo is ready, ${firstName}!`,
      bodyHtml: `
        <p>Our studio has finished hand-crafting the initial version of your website. You can explore the live interactive preview right now:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${demoUrl}" style="color:#96432b;font-weight:bold;">${demoUrl}</a>
        </p>
        <p>Once you're happy with the direction, click the second button below to upload your high-res logo, menu/price list, and domain details so we can polish and launch your site.</p>
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
    smsText = `Hey ${firstName}, quick check-in from WynnPages! Have you had a chance to preview your website demo (${demoUrl})? Submit your final logo/menu here whenever you're ready so we can launch on schedule: ${demoBriefUrl}`;
    emailSubject = `Quick Check-in: Ready to Finalise Your WynnPages Website?`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Friendly Studio Reminder',
      heading: `How do you like your new website demo, ${firstName}?`,
      bodyHtml: `
        <p>Just a friendly check-in from the WynnPages studio! Your bespoke website demo is waiting for your review:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${demoUrl}" style="color:#96432b;font-weight:bold;">${demoUrl}</a>
        </p>
        <p>To keep your 7-day launch right on track, please upload your final logo, pricing/menu, or any tweak requests using the link below:</p>
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
    const previewLink = client.id ? `${origin}/preview?cid=${encodeURIComponent(client.id)}` : demoUrl;
    const claimLink = client.id ? `${origin}/api/claim?cid=${encodeURIComponent(client.id)}` : `${origin}/api/claim?email=${encodeURIComponent(email)}`;
    smsText = `G'day ${firstName}! We hand-crafted a custom website demo specifically for ${bizLabel}: ${previewLink} - If you love it, you can claim 100% ownership for a flat $599 AUD (zero monthly fees): ${claimLink}`;
    emailSubject = `We Built a Custom Website Demo for ${bizLabel}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Bespoke Demo Ready to Preview',
      heading: `We hand-crafted a custom website for ${bizLabel}.`,
      bodyHtml: `
        <p>G'day ${firstName},</p>
        <p>Our Australian web studio admired <strong>${bizLabel}</strong> and proactively hand-crafted a complete, mobile-optimised website demo tailored to your brand:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a>
        </p>
        <p>There are <strong>zero forms to fill out</strong> and <strong>zero monthly retainers</strong>. If you love the design, simply click the button on the demo (or below) to claim full ownership for a flat <strong>$599 AUD</strong> and we will connect it to your domain within 7 days.</p>
      `,
      primaryCta: {
        label: 'Preview Your Live Demo Website',
        url: previewLink
      },
      secondaryCta: {
        label: 'Claim This Website Directly ($599 AUD)',
        url: claimLink
      }
    });
  } else if (stage === 'outbound_followup') {
    const bizLabel = client.businessName || client.name || 'your business';
    const previewLink = client.id ? `${origin}/preview?cid=${encodeURIComponent(client.id)}` : demoUrl;
    const claimLink = client.id ? `${origin}/api/claim?cid=${encodeURIComponent(client.id)}` : `${origin}/api/claim?email=${encodeURIComponent(email)}`;
    smsText = `Hey ${firstName}, quick check-in from WynnPages! Did you get a chance to see the custom website demo we built for ${bizLabel}? Preview it here: ${previewLink}`;
    emailSubject = `Quick Check-in: Your Custom Website Demo for ${bizLabel}`;
    emailHtml = buildAtelierEmailHtml({
      preheader: 'Custom Website Demo Preview',
      heading: `Did you get a chance to preview your demo, ${firstName}?`,
      bodyHtml: `
        <p>Just a friendly follow-up from the WynnPages studio! We're holding the custom website demo we built for <strong>${bizLabel}</strong>:</p>
        <p style="background-color:#fcf9f3;border:1px solid #e5dec9;border-radius:12px;padding:12px 16px;font-family:monospace;font-size:13px;">
          <a href="${previewLink}" style="color:#96432b;font-weight:bold;">${previewLink}</a>
        </p>
        <p>If you'd like us to make it officially yours and launch it on your domain for a one-off <strong>$599 AUD</strong> (no ongoing fees), you can claim it with one click below:</p>
      `,
      primaryCta: {
        label: 'Open Your Live Website Demo',
        url: previewLink
      },
      secondaryCta: {
        label: 'Claim This Website ($599 AUD)',
        url: claimLink
      }
    });
  } else if (stage === 'site_launched') {
    const liveUrl = client.existingDomain
      ? (client.existingDomain.startsWith('http') ? client.existingDomain : `https://${client.existingDomain}`)
      : demoUrl;
    smsText = `Congratulations ${firstName}! Your bespoke WynnPages website is officially LIVE at ${liveUrl} — Thank you for trusting our Australian studio!`;
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

  return { smsResult, emailResult, stage };
}

function buildAiPromptForClient(c) {
  return [
    `=== WYNNPAGES ATELIER AI DESIGN BRIEF ===`,
    `Client / Account Name: ${c.name || 'N/A'}`,
    `Business Name (Trading Name): ${c.businessName || c.name || 'N/A'}`,
    `Client Email: ${c.email || 'N/A'}`,
    `Client Mobile (SMS): ${c.phone || 'N/A'}`,
    `Display Phone (For Website): ${c.displayPhone || c.phone || 'N/A'}`,
    `Business Address / Service Area: ${c.businessAddress || 'N/A'}`,
    `Social Media & Booking Links: ${c.socialLinks || 'N/A'}`,
    `Brief Type: ${c.briefType || 'organic'}`,
    `Current Stage: ${c.stage || 'brief_completed'}`,
    `Industry / Niche: ${c.industry || 'See notes'}`,
    `Preferred Brand Colors: ${c.brandColors || 'Curated Atelier Palette'}`,
    `Reference Websites / Vibe Links: ${c.vibeLinks || 'N/A'}`,
    `Has Existing Domain?: ${c.hasDomain || 'N/A'}`,
    `Existing Domain: ${c.existingDomain || 'N/A'}`,
    `Desired Domains to Check: ${c.desiredDomains || 'N/A'}`,
    `Logo Asset: ${c.logoFileName || 'N/A'} ${c.logoFileId ? `(Stripe File ID: ${c.logoFileId})` : ''}`,
    `Menu / Pricing Asset: ${c.menuFileName || 'N/A'} ${c.menuFileId ? `(Stripe File ID: ${c.menuFileId})` : ''}`,
    `Professional Photos?: ${c.hasPhotos || 'N/A'} ${c.photosFileName ? `(${c.photosFileName})` : ''} ${c.photosFileId ? `[Stripe File ID: ${c.photosFileId}]` : ''}`,
    `Demo URL: ${c.demoUrl || 'Not assigned yet'}`,
    `Submitted At: ${c.submittedAt || 'N/A'}`,
    `=========================================`,
    `Instruction for AI: Design and code a bespoke, high-converting Australian small-business website for "${c.businessName || c.name || 'Local Business'}" (${c.industry || 'Service Business'}) located at "${c.businessAddress || 'Australia'}", displaying phone "${c.displayPhone || c.phone || ''}", social/booking links "${c.socialLinks || ''}", incorporating the color palette "${c.brandColors || 'Warm Parchment & Terracotta'}" and drawing layout/vibe inspiration from "${c.vibeLinks || 'WynnPages Atelier aesthetic'}".`
  ].join('\n');
}

function formatCustomerRecord(cust) {
  const m = cust.metadata || {};
  const rawStage = m.stage || (m.brief_status === 'completed' ? 'brief_completed' : 'paid');
  const flowType = m.flow_type || (rawStage.startsWith('outbound_') ? 'outbound' : 'inbound');
  const paymentStatus = m.payment_status || ((flowType === 'outbound' && rawStage !== 'outbound_paid' && rawStage !== 'launched' && !m.checkout_session_id) ? 'unpaid' : 'paid');
  const record = {
    id: cust.id,
    name: cust.name || m.customer_name || m.business_name || '',
    businessName: m.business_name || '',
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
    logoFileId: m.logo_file_id || '',
    logoFileName: m.logo_file_name || '',
    menuFileId: m.menu_file_id || '',
    menuFileName: m.menu_file_name || '',
    hasPhotos: m.has_photos || '',
    photosFileId: m.photos_file_id || '',
    photosFileName: m.photos_file_name || '',
    demoUrl: m.demo_url || '',
    checkoutSessionId: m.checkout_session_id || '',
    welcomeSent: m.welcome_sent || 'false',
    lastSmsLog: m.last_sms_log || '',
    lastEmailLog: m.last_email_log || '',
    demoSentAt: m.demo_sent_at || '',
    reminderCount: Number(m.reminder_count || 0),
    launchedAt: m.launched_at || '',
    submittedAt: m.submitted_at || new Date((cust.created || 0) * 1000).toISOString(),
    created: cust.created
  };
  record.aiPrompt = buildAiPromptForClient(record);
  return record;
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

    const cfg = getConfig(env);

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
        const successUrl = `${origin}/demo-success?session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}&cid=${encodeURIComponent(cid)}`;
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

        if (env.STRIPE_PRICE_ID) {
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
          const clientObj = {
            name: name || (cust && cust.name) || '',
            email: email || (cust && cust.email) || '',
            phone: phone || (cust && cust.phone) || (cust && cust.metadata && cust.metadata.customer_phone) || ''
          };
          notifyRes = await triggerLifecycleNotification({
            stage: 'payment_confirmed',
            client: clientObj,
            origin: url.origin,
            cfg
          });

          const isOutboundSession = sessionData.metadata && sessionData.metadata.flow === 'outbound_demo';
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
        let existingCustomerId = '';

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
        const logoLink = (body.logoLink || '').trim();
        const menuLink = (body.menuLink || '').trim();
        const hasPhotos = (body.hasPhotos || '').trim();
        const photosLink = (body.photosLink || '').trim();

        if (!customerName && businessName) customerName = businessName;
        if (!customerPhone && displayPhone) customerPhone = displayPhone;

        // Optional file uploads to Stripe Files API
        let logoFileId = null;
        let menuFileId = null;
        let photosFileId = null;
        if (body.logoFile && body.logoFile.dataUrl) {
          logoFileId = await uploadStripeFile(body.logoFile, cfg.stripeSecretKey);
        }
        if (body.menuFile && body.menuFile.dataUrl) {
          menuFileId = await uploadStripeFile(body.menuFile, cfg.stripeSecretKey);
        }
        if (body.photosFile && body.photosFile.dataUrl) {
          photosFileId = await uploadStripeFile(body.photosFile, cfg.stripeSecretKey);
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

        // Look up existing customer by email if not linked via session
        if (!existingCustomerId && email) {
          const found = await findStripeCustomerByEmail(email, cfg.stripeSecretKey);
          if (found) {
            existingCustomerId = found.id;
            if (!customerName) customerName = found.name || (found.metadata && found.metadata.customer_name) || '';
            if (!customerPhone) customerPhone = found.phone || (found.metadata && found.metadata.customer_phone) || '';
          }
        }

        const isExistingDom = hasDomain === 'I already own a domain' || hasDomain === 'Yes, I have one';
        const domainSummary = isExistingDom ? existingDomain : desiredDomains;
        const metadataEntries = {
          studio: 'WynnPages Australia',
          stage: 'brief_completed',
          brief_status: 'completed',
          brief_type: briefType,
          submitted_at: new Date().toISOString(),
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
          existing_domain: existingDomain.slice(0, 490),
          desired_domains: desiredDomains.slice(0, 490),
          logo_file_id: logoFileId || '',
          logo_file_name: (body.logoFile && body.logoFile.name ? body.logoFile.name : logoLink).slice(0, 490),
          menu_file_id: menuFileId || '',
          menu_file_name: (body.menuFile && body.menuFile.name ? body.menuFile.name : menuLink).slice(0, 490),
          has_photos: hasPhotos.slice(0, 490),
          photos_file_id: photosFileId || '',
          photos_file_name: (body.photosFile && body.photosFile.name ? body.photosFile.name : photosLink).slice(0, 490)
        };

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

        // Trigger Stage 2 SMS + Email to Client
        const clientRecord = {
          name: customerName,
          email,
          phone: customerPhone,
          briefType,
          industry,
          brandColors,
          vibeLinks,
          existingDomain,
          desiredDomains
        };

        const notification = await triggerLifecycleNotification({
          stage: 'brief_completed',
          client: clientRecord,
          origin: url.origin,
          cfg
        });

        return new Response(
          JSON.stringify({
            ok: true,
            customerId: custData.id || null,
            paymentIntentId: paymentIntentId || null,
            logoFileId,
            menuFileId,
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

      return new Response(
        JSON.stringify({
          ok: true,
          count: clients.length,
          integrations: {
            stripe: Boolean(cfg.stripeSecretKey),
            clicksend: Boolean(cfg.clicksendUsername && cfg.clicksendApiKey),
            resend: Boolean(cfg.resendApiKey),
            resendFromEmail: cfg.resendFromEmail
          },
          clients
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    // 6. Admin Command Center Action Endpoint (POST /api/admin/action)
    if (url.pathname === '/api/admin/action' && request.method === 'POST') {
      try {
        const body = await request.json().catch(() => ({}));
        const providedKey = body.adminKey || request.headers.get('x-admin-key') || '';
        if (providedKey !== cfg.adminKey) {
          return new Response(JSON.stringify({ error: 'Invalid Admin Passcode.' }), { status: 401, headers: corsHeaders });
        }

        const effectiveCfg = getConfig(env, body.credentials || {});
        const action = body.action || '';
        const customerId = (body.customerId || '').trim();

        // Action 0: Delete Client Record
        if (action === 'delete_client' && customerId) {
          const delRes = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${effectiveCfg.stripeSecretKey}` }
          });
          const delData = await delRes.json().catch(() => ({}));
          return new Response(JSON.stringify({ ok: delRes.ok, deleted: delData }), { status: 200, headers: corsHeaders });
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

          const uParams = new URLSearchParams();
          const email = (body.email !== undefined ? body.email : (cust && cust.email) || '').trim();
          const name = (body.name !== undefined ? body.name : (cust && cust.name) || '').trim();
          const phone = (body.phone !== undefined ? body.phone : (cust && cust.phone) || '').trim();
          const demoUrl = (body.demoUrl !== undefined ? body.demoUrl : (cust && cust.metadata && cust.metadata.demo_url) || '').trim();
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
          if (body.demoUrl !== undefined) uParams.append('metadata[demo_url]', demoUrl);
          if (body.industry !== undefined) {
            uParams.append('metadata[industry]', body.industry);
            if (body.industry) uParams.append('metadata[brief_status]', 'completed');
          }
          if (body.brandColors !== undefined) uParams.append('metadata[brand_colors]', body.brandColors);
          if (body.vibeLinks !== undefined) uParams.append('metadata[vibe_links]', body.vibeLinks);
          if (body.existingDomain !== undefined) uParams.append('metadata[existing_domain]', body.existingDomain);
          if (body.desiredDomains !== undefined) uParams.append('metadata[desired_domains]', body.desiredDomains);
          if (body.flowType !== undefined) uParams.append('metadata[flow_type]', body.flowType);
          if (body.paymentStatus !== undefined) uParams.append('metadata[payment_status]', body.paymentStatus);

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
          }

          return new Response(
            JSON.stringify({
              ok: true,
              client: formatted,
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

    // 7. Default static assets fetch
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  }
};
