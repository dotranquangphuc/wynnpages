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
    googlePlacesApiKey: overrides.googlePlacesApiKey || overrides.googlePlacesKey || env.GOOGLE_PLACES_API_KEY || ''
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
    const demoSuccessUrl = `${origin}/demo-success?email=${encodeURIComponent(email)}&cid=${encodeURIComponent(client.id || '')}`;
    smsText = `Hi ${firstName}, congratulations! Your payment of $599 AUD for ${bizLabel} is confirmed. Please finalize your domain details here so we can launch your website: ${demoSuccessUrl} - For any questions, please email hello@wynnpages.com.au. Warm regards, Wynn`;
    emailSubject = `Payment Secured! Please Confirm Your Domain to Go Live`;
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
    launchedAt: m.launched_at || '',
    submittedAt: m.submitted_at || new Date((cust.created || 0) * 1000).toISOString(),
    created: cust.created
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

function buildClaimBarSnippet(client) {
  const bizName = (client && (client.businessName || client.name)) || 'Your Business';
  const cid = (client && client.id) || '';
  const email = (client && client.email) || '';
  const claimHref = `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}`;

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
      background: rgba(28, 25, 23, 0.96);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
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
      .claim-bar { flex-direction: column; align-items: stretch; padding: 12px 14px; bottom: 12px; gap: 10px; border-radius: 18px; }
      .claim-actions { display: grid; grid-template-columns: auto 1fr; gap: 8px; width: 100%; }
      .claim-studio-btn { justify-content: center; padding: 11px 12px; font-size: 11.5px; }
      .claim-btn { justify-content: center; padding: 11px 14px; font-size: 12px; }
      .claim-tag-text { display: none; }
      .claim-bullet { display: none; }
      .claim-for-text { font-size: 10.5px; }
      .claim-biz-highlight { font-size: 15px; }
    }
  </style>
  <div class="claim-bar">
    <div class="claim-left">
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="claim-badge" title="Visit WynnPages Studio (wynnpages.com.au)">
        <img src="https://wynnpages.com.au/assets/favicon-light.png" alt="WynnPages Atelier" class="claim-badge-img">
      </a>
      <div class="claim-meta">
        <div class="claim-tag">
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
        </div>
        <div class="claim-title">
          <span class="claim-for-text">Crafted exclusively for</span>
          <strong class="claim-biz-highlight">${bizName}</strong>
        </div>
      </div>
    </div>
    <div class="claim-actions">
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" class="claim-studio-btn" title="Explore WynnPages Web Atelier">
        <span>About Studio</span>
        <svg class="claim-ext-arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"/>
        </svg>
      </a>
      <a href="${claimHref}" class="claim-btn">
        <span>Claim This Website — $599 AUD</span>
        <span class="claim-arrow">&rarr;</span>
      </a>
    </div>
  </div>`;
}

function injectClaimBarIntoHtml(rawHtml, client) {
  const spacer = `<style>.wynn-claim-clearance{height:108px;width:100%;pointer-events:none;}@media(max-width:640px){.wynn-claim-clearance{height:142px;}}</style><div class="wynn-claim-clearance" aria-hidden="true"></div>`;
  const snippet = spacer + buildClaimBarSnippet(client);
  if (rawHtml.includes('</body>')) {
    return rawHtml.replace('</body>', `${snippet}</body>`);
  }
  return rawHtml + snippet;
}

function buildBrandedPreviewHtml(client) {
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

async function serveClientSpecialSeoOrAsset({ slug, client, reqPath, url, env, stripeSecretKey, isLiveDomain, isPathDemo, forceBar }) {
  const cleanSlug = slugifyName(slug);
  const baseOrigin = isPathDemo && cleanSlug ? `https://${cleanSlug}.wynnpages.com.au` : url.origin;

  // 1. HTML pages from KV
  if (env && env.WYNN_KV && cleanSlug && (reqPath === '/index.html' || reqPath.endsWith('.html'))) {
    const rawHtml = await env.WYNN_KV.get(`site_asset:${cleanSlug}:${reqPath}`, 'text');
    if (rawHtml) {
      const resolvedClient = client || (stripeSecretKey ? await findCustomerBySlugOrId(slug, stripeSecretKey) : null);
      let finalHtml = ensureClientHtmlSeoTags(rawHtml, resolvedClient, url, isPathDemo, cleanSlug);
      if (!isLiveDomain && (!resolvedClient || resolvedClient.stage !== 'launched' || forceBar)) {
        finalHtml = injectClaimBarIntoHtml(finalHtml, resolvedClient || { businessName: slug, demoSlug: cleanSlug });
      }
      return new Response(finalHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=0, must-revalidate'
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

    if (isSubdomainDemo || isPathDemo) {
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
        env,
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
          const html = (client.stage === 'launched' && !forceBar)
            ? buildCleanLiveHtml(client, url.origin)
            : buildBrandedPreviewHtml(client);
          return new Response(html, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
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
        if (cfg.resendApiKey) {
          const customerLabel = bizName || (cust && (cust.metadata && cust.metadata.business_name || cust.name)) || 'A client';
          const domainLabel = cleanHost || (cust && cust.metadata && cust.metadata.live_url) || rawDomain || 'TBD';
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

      if (env && env.WYNN_KV) {
        await Promise.all(clients.map(async (c) => {
          if (!c.demoPalette || c.demoPalette === '01') {
            const meta = await env.WYNN_KV.get(`site_meta:${c.demoSlug}`, 'json').catch(() => null);
            if (meta && meta.palette) {
              c.demoPalette = meta.palette;
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
          'places.regularOpeningHours',
          'places.reviews'
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

          // Classification
          let leadType = 'custom_web';
          let statusBadge = '⚪ Đã có Web riêng';
          let priorityScore = 1;
          let bookingOrSocialLink = '';

          if (!website) {
            leadType = 'hot_lead_no_web';
            statusBadge = '🔴 Chưa có Web (Hot Lead)';
            priorityScore = 3;
          } else if (socialRegex.test(website)) {
            leadType = 'social_booking_only';
            statusBadge = '🟡 Chỉ dùng MXH / Link Booking';
            priorityScore = 2;
            bookingOrSocialLink = website;
          }

          // Extract Australian Suburb / State from address
          let suburb = '';
          const auMatch = address.match(/([A-Z\s]+)\s+(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s+(\d{4})/i);
          if (auMatch) {
            suburb = `${auMatch[1].trim()}, ${auMatch[2].toUpperCase()} ${auMatch[3]}`;
          }

          const industry = classifyLeadIndustry(rawSelectedIndustry, keyword, name);
          const industryLabel = getLeadIndustryLabel(industry);

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
            leadType,
            statusBadge,
            priorityScore,
            bookingOrSocialLink,
            openingHours: weekdayDescriptions,
            topReviews,
            industry,
            industryLabel,
            imported: false,
            scannedKeyword: keyword,
            scannedLocation: location
          };
        });

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

    // 7. Default static assets fetch
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  }
};
