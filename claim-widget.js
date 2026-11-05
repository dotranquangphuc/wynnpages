/**
 * WynnPages Atelier — Outbound Demo "Claim This Website - $599 AUD" Floating Bar Widget
 * Usage on any Demo Site:
 * <script src="https://wynnpages.com.au/claim-widget.js" data-cid="cus_XXX" data-email="client@example.com" data-name="Business Name"></script>
 */
(function () {
  if (document.getElementById('wynnpages-claim-bar')) return;

  const currentScript = document.currentScript || document.querySelector('script[src*="claim-widget.js"]');
  const urlParams = new URLSearchParams(window.location.search);

  const cid = (currentScript && currentScript.getAttribute('data-cid')) || urlParams.get('cid') || '';
  const email = (currentScript && currentScript.getAttribute('data-email')) || urlParams.get('email') || '';
  const bizName = (currentScript && currentScript.getAttribute('data-name')) || urlParams.get('name') || 'Your Business';
  const checkoutUrlOverride = (currentScript && currentScript.getAttribute('data-checkout-url')) || '';

  const claimHref = checkoutUrlOverride ||
    `https://wynnpages.com.au/api/claim?cid=${encodeURIComponent(cid)}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(bizName)}&demo=${encodeURIComponent(window.location.href)}`;

  const bar = document.createElement('div');
  bar.id = 'wynnpages-claim-bar';
  bar.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483647',
    'width:calc(100% - 28px)',
    'max-width:680px',
    'background:rgba(35,31,26,0.96)',
    'backdrop-filter:blur(16px)',
    '-webkit-backdrop-filter:blur(16px)',
    'color:#fcf9f3',
    'border:1px solid rgba(232,185,72,0.35)',
    'border-radius:20px',
    'padding:12px 16px 12px 20px',
    'box-shadow:0 20px 50px rgba(0,0,0,0.35)',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:14px',
    'font-family:-apple-system,BlinkMacSystemFont,"Plus Jakarta Sans","Segoe UI",Roboto,sans-serif',
    'box-sizing:border-box'
  ].join(';');

  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;min-width:0;">
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
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
      <a href="https://wynnpages.com.au" target="_blank" rel="noopener" style="background:rgba(255,255,255,0.06);border:1px solid rgba(229,222,201,0.22);color:#f6f1e8;text-decoration:none;font-size:12px;font-weight:600;padding:11px 14px;border-radius:13px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;transition:all 0.2s ease;" title="Visit WynnPages Studio">
        <span>About Studio</span>
        <svg style="width:10px;height:10px;" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"/>
        </svg>
      </a>
      <a id="wynnpages-claim-btn" href="${claimHref}" style="background:#96432b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:800;padding:11px 20px;border-radius:13px;white-space:nowrap;flex-shrink:0;box-shadow:0 6px 18px rgba(150,67,43,0.45);transition:all 0.2s ease;display:inline-flex;align-items:center;gap:6px;">
        <span>Claim This Website &mdash; $599 AUD</span>
        <span>&rarr;</span>
      </a>
    </div>
  `;

  function mount() {
    document.body.appendChild(bar);
    const btn = document.getElementById('wynnpages-claim-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        btn.style.opacity = '0.85';
        btn.innerHTML = '<span>Opening Secure Checkout...</span>';
      });
    }
  }

  if (document.body) {
    mount();
  } else {
    window.addEventListener('DOMContentLoaded', mount);
  }
})();
