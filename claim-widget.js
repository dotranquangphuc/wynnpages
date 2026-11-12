/**
 * WynnPages Atelier — Outbound Demo "Claim This Website - $599 AUD" Floating Bar Widget
 * Usage on any Demo Site:
 * <script src="https://wynnpages.com.au/claim-widget.js" data-cid="cus_XXX" data-email="client@example.com" data-name="Business Name"></script>
 */
(function () {
  if (document.getElementById('wynnpages-claim-bar')) return;

  const currentScript = document.currentScript || document.querySelector('script[src*="claim-widget.js"]');
  const urlParams = new URLSearchParams(window.location.search);

  const cid = (currentScript && currentScript.getAttribute('data-cid')) || urlParams.get('cid') || urlParams.get('client_id') || '';
  const email = (currentScript && currentScript.getAttribute('data-email')) || urlParams.get('email') || '';
  const bizName = (currentScript && currentScript.getAttribute('data-name')) || urlParams.get('name') || 'Your Business';
  const checkoutUrlOverride = (currentScript && currentScript.getAttribute('data-checkout-url')) || '';
  const hostLower = (window.location.hostname || '').toLowerCase();
  const pathMatch = (window.location.pathname || '').match(/^\/d\/([^/]+)/i);
  const hostSlug = hostLower.endsWith('.wynnpages.com.au') && hostLower !== 'wynnpages.com.au' && hostLower !== 'www.wynnpages.com.au'
    ? hostLower.split('.')[0]
    : '';
  const clientSlug = ((currentScript && currentScript.getAttribute('data-slug')) || urlParams.get('slug') || (pathMatch && pathMatch[1]) || hostSlug || cid || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  const claimHref = checkoutUrlOverride ||
    `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}&demo=${encodeURIComponent(window.location.href)}`;
  const revisionHref = `https://wynnpages.com.au/revision.html?client_id=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}`;

  if (!document.getElementById('wynnpages-claim-glass-style')) {
    const gStyle = document.createElement('style');
    gStyle.id = 'wynnpages-claim-glass-style';
    gStyle.textContent = '#atelier-float-dock{display:none!important;opacity:0!important;pointer-events:none!important;}#atelier-nav-shell{min-width:0!important;}#atelier-nav-shell>a:first-child{min-width:0!important;flex:1 1 auto!important;overflow:hidden!important;}#atelier-nav-shell>a:first-child>div:last-child{min-width:0!important;flex:1 1 auto!important;overflow:hidden!important;}#nav-salon-name{display:block!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%!important;font-size:clamp(15px,4.2vw,22px)!important;line-height:1.15!important;}#nav-salon-sub{display:block!important;min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%!important;}#atelier-header button[data-open-booking],header button[data-open-booking]{white-space:nowrap!important;flex-shrink:0!important;display:inline-flex!important;align-items:center!important;gap:6px!important;padding-left:14px!important;padding-right:14px!important;}#atelier-header button[data-open-booking] svg:not(:first-child),header button[data-open-booking] svg:not(:first-child),#atelier-header button[data-open-booking] .wynn-merged-phone-icon~svg,header button[data-open-booking] .wynn-merged-phone-icon~svg{display:none!important;}#atelier-header #btn-mobile-menu,header #btn-mobile-menu{flex-shrink:0!important;}';
    (document.head || document.documentElement).appendChild(gStyle);
  }

  const bar = document.createElement('div');
  bar.id = 'wynnpages-claim-bar';
  bar.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'left:50%',
    'transform:translateX(-50%) translateY(0)',
    'z-index:2147483647',
    'width:calc(100% - 28px)',
    'max-width:760px',
    'background:rgba(28,22,19,0.58) !important',
    'backdrop-filter:blur(22px) saturate(180%) !important',
    '-webkit-backdrop-filter:blur(22px) saturate(180%) !important',
    'color:#fcf9f3',
    'border:1px solid rgba(255,255,255,0.22) !important',
    'border-radius:20px',
    'padding:28px 18px 14px 18px',
    'box-shadow:0 20px 50px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.25) !important',
    'display:flex',
    'flex-wrap:wrap',
    'align-items:center',
    'justify-content:space-between',
    'gap:12px 16px',
    'font-family:-apple-system,BlinkMacSystemFont,"Plus Jakarta Sans","Segoe UI",Roboto,sans-serif',
    'box-sizing:border-box',
    'transition:transform 0.35s cubic-bezier(0.16,1,0.3,1),opacity 0.25s ease'
  ].join(';');

  const restoreTab = document.createElement('button');
  restoreTab.id = 'wynnpages-claim-restore';
  restoreTab.type = 'button';
  restoreTab.setAttribute('aria-label', 'Expand website banner');
  restoreTab.innerHTML = '<span style="width:6px;height:6px;border-radius:9999px;background:#C85A32;box-shadow:0 0 8px rgba(200,90,50,0.95);flex-shrink:0;"></span><svg width="12" height="7" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8L9 2L16 8"/></svg><span>Claim This Website <span style="color:#f3a683;font-weight:800;">&mdash; $599</span></span>';
  restoreTab.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:calc(14px + env(safe-area-inset-bottom,0px))',
    'z-index:2147483646',
    'display:inline-flex',
    'align-items:center',
    'justify-content:center',
    'gap:7px',
    'background:rgba(28,22,19,0.58) !important',
    'backdrop-filter:blur(22px) saturate(180%) !important',
    '-webkit-backdrop-filter:blur(22px) saturate(180%) !important',
    'color:rgba(255,255,255,0.96)',
    'border:1px solid rgba(255,255,255,0.22) !important',
    'border-radius:9999px',
    'padding:8px 16px',
    'font-family:-apple-system,BlinkMacSystemFont,"Plus Jakarta Sans","Segoe UI",Roboto,sans-serif',
    'font-size:12px',
    'font-weight:700',
    'letter-spacing:0.01em',
    'white-space:nowrap',
    'box-shadow:0 20px 50px rgba(0,0,0,0.35),inset 0 1px 0 rgba(255,255,255,0.25) !important',
    'cursor:pointer',
    'opacity:0',
    'transform:translateX(-50%) translateY(16px)',
    'pointer-events:none',
    'transition:all 0.28s cubic-bezier(0.16,1,0.3,1)'
  ].join(';');

  function renderBarHtml(isPaid) {
    const collapseHandleHtml = `
      <button type="button" id="wynnpages-claim-collapse" title="Minimise bar" aria-label="Minimise bar" style="position:absolute;top:6px;left:50%;transform:translateX(-50%);background:transparent;border:none;padding:2px 16px;margin-bottom:6px;color:#ffffff;opacity:0.65;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:opacity 0.2s ease,transform 0.2s ease;line-height:1;">
        <svg width="15" height="8" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2L9 8L16 2"/></svg>
      </button>
    `;
    const isNarrow = window.innerWidth <= 640;
    bar.style.padding = isNarrow ? '28px 14px 12px 14px' : '28px 18px 14px 18px';
    if (isPaid) {
      bar.style.setProperty('background', 'rgba(16,31,24,0.62)', 'important');
      bar.style.setProperty('border', '1.5px solid rgba(52,211,153,0.48)', 'important');
      restoreTab.innerHTML = '<span style="width:6px;height:6px;border-radius:9999px;background:#34d399;box-shadow:0 0 8px rgba(52,211,153,0.9);flex-shrink:0;"></span><svg width="12" height="7" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8L9 2L16 8"/></svg><span>Next Step &bull; Setup Content</span>';
      bar.innerHTML = `
        ${collapseHandleHtml}
        <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 240px;">
          <a href="https://wynnpages.com.au" target="_blank" rel="noopener" style="width:40px;height:40px;border-radius:12px;background:#059669;display:flex;align-items:center;justify-content:center;flex-shrink:0;text-decoration:none;border:1px solid rgba(167,243,208,0.55);overflow:hidden;padding:3.5px;" title="Visit WynnPages Studio (wynnpages.com.au)">
            <img src="https://wynnpages.com.au/assets/favicon-light.png" alt="WynnPages Atelier" style="width:100%;height:100%;object-fit:contain;display:block;">
          </a>
          <div style="min-width:0;">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#6ee7b7;font-weight:800;margin-bottom:2px;">🎉 OFFICIALLY CLAIMED &bull; 100% CLIENT OWNERSHIP</div>
            <div style="font-size:14.5px;font-weight:800;color:#ffffff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🎉 This website has been officially claimed!</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-shrink:0;${isNarrow ? 'width:100%;' : ''}">
          <a href="${revisionHref}" style="${isNarrow ? 'width:100%;justify-content:center;text-align:center;' : ''}background:linear-gradient(135deg,#059669 0%,#047857 100%);color:#ffffff;text-decoration:none;font-size:12.5px;font-weight:800;padding:11px 18px;border-radius:13px;white-space:normal;flex-shrink:0;box-shadow:0 6px 18px rgba(5,150,105,0.45);display:inline-flex;align-items:center;gap:6px;">
            <span>👉 Click here to proceed to the next step (Customise Content &amp; Domain Setup)</span>
          </a>
        </div>
      `;
    } else {
      bar.innerHTML = `
        ${collapseHandleHtml}
        <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 240px;">
          <a href="https://wynnpages.com.au" target="_blank" rel="noopener" style="width:40px;height:40px;border-radius:12px;background:#96432b;display:flex;align-items:center;justify-content:center;flex-shrink:0;text-decoration:none;border:1px solid rgba(232,185,72,0.45);overflow:hidden;padding:3.5px;box-shadow:0 4px 14px rgba(0,0,0,0.35);transition:all 0.2s ease;" title="Visit WynnPages Studio (wynnpages.com.au)">
            <img src="https://wynnpages.com.au/assets/favicon-light.png" alt="WynnPages Atelier" style="width:100%;height:100%;object-fit:contain;display:block;">
          </a>
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:nowrap;white-space:nowrap;overflow:hidden;margin-bottom:2px;">
              <a href="https://wynnpages.com.au" target="_blank" rel="noopener" style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#e8b948;font-weight:800;background:rgba(232,185,72,0.12);border:1px solid rgba(232,185,72,0.3);padding:1px 6px;border-radius:5px;text-decoration:none;display:inline-flex;align-items:center;gap:3px;flex-shrink:0;" title="Visit WynnPages Studio">
                <span>wynnpages.com.au</span>
                <svg style="width:9px;height:9px;" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"/>
                </svg>
              </a>
              <span style="font-size:8px;color:rgba(251,222,185,0.4);flex-shrink:0;">&bull;</span>
              <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:rgba(251,222,185,0.85);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Bespoke Demo &bull; No Monthly Fees</span>
            </div>
            <div style="display:flex;align-items:baseline;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span style="font-size:11px;font-weight:600;color:#b8b0a5;letter-spacing:0.03em;text-transform:uppercase;flex-shrink:0;">Crafted exclusively for</span>
              <strong style="font-size:16px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;overflow:hidden;text-overflow:ellipsis;">${bizName.replace(/</g, '&lt;')}</strong>
            </div>
          </div>
        </div>
        <div style="display:flex;${isNarrow ? 'flex-direction:column;width:100%;align-items:center;' : 'flex-direction:row;align-items:center;'}gap:8px;flex-shrink:0;">
          <a id="wynnpages-claim-btn" href="${claimHref}" style="${isNarrow ? 'width:100%;justify-content:center;text-align:center;' : ''}background:linear-gradient(135deg,#B85332 0%,#96432b 100%) !important;opacity:1 !important;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;padding:12px 20px;border-radius:13px;white-space:nowrap;flex-shrink:0;border:1px solid rgba(255,255,255,0.26);box-shadow:0 10px 26px rgba(150,67,43,0.55),0 4px 12px rgba(0,0,0,0.28);transition:all 0.2s ease;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;">
            <span>Claim This Website &mdash; $599 AUD</span>
            <span>&rarr;</span>
          </a>
          <a href="https://wynnpages.com.au" target="_blank" rel="noopener" style="${isNarrow ? 'padding:4px 10px;font-size:11px;border:none;background:transparent;color:rgba(255,255,255,0.68);text-decoration:underline;' : 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.16);color:#f6f1e8;padding:11px 14px;border-radius:13px;font-size:12px;'}text-decoration:${isNarrow ? 'underline' : 'none'};font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;transition:all 0.2s ease;" title="Visit WynnPages Studio">
            <span>About Studio</span>
            <svg style="width:10px;height:10px;" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"/>
            </svg>
          </a>
        </div>
      `;
    }
    const collapseBtn = document.getElementById('wynnpages-claim-collapse');
    if (collapseBtn) {
      collapseBtn.addEventListener('mouseenter', function () {
        collapseBtn.style.opacity = '1';
      });
      collapseBtn.addEventListener('mouseleave', function () {
        collapseBtn.style.opacity = '0.65';
      });
      collapseBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setBarCollapsed(true);
      });
    }
    const btn = document.getElementById('wynnpages-claim-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        sendWynnTrack('claim_click');
        btn.style.opacity = '0.85';
        btn.innerHTML = '<span>Opening Secure Checkout...</span>';
      });
    }
  }

  let isBarCollapsed = false;
  let manualCollapsedAt = 0;
  function setBarCollapsed(collapsed) {
    isBarCollapsed = Boolean(collapsed);
    if (isBarCollapsed) {
      manualCollapsedAt = Date.now();
      bar.style.transform = 'translateX(-50%) translateY(calc(100% + 48px))';
      bar.style.opacity = '0';
      bar.style.pointerEvents = 'none';
      restoreTab.style.opacity = '1';
      restoreTab.style.transform = 'translateX(-50%) translateY(0)';
      restoreTab.style.pointerEvents = 'auto';
    } else {
      bar.style.transform = 'translateX(-50%) translateY(0)';
      bar.style.opacity = '1';
      bar.style.pointerEvents = 'auto';
      restoreTab.style.opacity = '0';
      restoreTab.style.transform = 'translateX(-50%) translateY(16px)';
      restoreTab.style.pointerEvents = 'none';
    }
  }

  function sendWynnTrack(evType) {
    try {
      if (!clientSlug && !cid) return;
      var q = window.location.search || '';
      if (q.indexOf('admin=') !== -1 || q.indexOf('preview=') !== -1 || q.indexOf('bar=1') !== -1) return;
      if (document.cookie && /(?:^|;\s*)wynn_admin=1(?:;|$)/.test(document.cookie)) return;
      if (window.localStorage && window.localStorage.getItem('wynn_admin_key')) return;
      var payload = JSON.stringify({ slug: clientSlug, clientId: cid || clientSlug, eventType: evType || 'demo_view' });
      var ep = 'https://wynnpages.com.au/api/track?slug=' + encodeURIComponent(clientSlug) + '&type=' + encodeURIComponent(evType || 'demo_view');
      if (navigator.sendBeacon) {
        if (navigator.sendBeacon(ep, new Blob([payload], { type: 'application/json' }))) return;
      }
      fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function () {});
    } catch (_) {}
  }

  function mount() {
    renderBarHtml(false);
    document.body.appendChild(bar);
    document.body.appendChild(restoreTab);

    try {
      var hdrBookBtn = document.querySelector('#atelier-header button[data-open-booking], header button[data-open-booking]');
      if (hdrBookBtn) {
        var svgs = hdrBookBtn.querySelectorAll('svg');
        svgs.forEach(function (s, idx) {
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

    restoreTab.addEventListener('click', function () {
      setBarCollapsed(false);
    });
    window.addEventListener('scroll', function () {
      if (!isBarCollapsed) return;
      if (Date.now() - manualCollapsedAt < 1200) return;
      var docH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      if (window.scrollY + window.innerHeight >= docH - 150) {
        setBarCollapsed(false);
      }
    }, { passive: true });

    if (cid || clientSlug) {
      fetch(`https://wynnpages.com.au/api/demo-status?cid=${encodeURIComponent(cid)}&slug=${encodeURIComponent(clientSlug)}`)
        .then(function (r) { return r.json(); })
        .then(function (st) {
          if (st && st.found && st.isPaid) renderBarHtml(true);
        })
        .catch(function () {});
    }

    var ssKey = 'wynn_dv_ss_' + (clientSlug || cid);
    var tracked = false;
    try { tracked = Boolean(window.sessionStorage && window.sessionStorage.getItem(ssKey)); } catch (_) {}
    var delayReady = false;
    var humanInteracted = false;
    function tryHumanTrack() {
      if (tracked || !delayReady || !humanInteracted) return;
      tracked = true;
      try { if (window.sessionStorage) window.sessionStorage.setItem(ssKey, String(Date.now())); } catch (_) {}
      sendWynnTrack('demo_view');
    }
    if (!tracked) {
      setTimeout(function () {
        delayReady = true;
        tryHumanTrack();
      }, 3000);
      var onHuman = function () {
        humanInteracted = true;
        tryHumanTrack();
      };
      ['scroll', 'touchstart', 'mousemove', 'keydown'].forEach(function (evName) {
        window.addEventListener(evName, onHuman, { once: true, passive: true });
      });
    }
  }

  if (document.body) {
    mount();
  } else {
    window.addEventListener('DOMContentLoaded', mount);
  }
})();
