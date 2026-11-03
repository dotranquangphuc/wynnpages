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
      <div style="width:36px;height:36px;border-radius:11px;background:#96432b;color:#fff;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-weight:bold;font-size:18px;flex-shrink:0;">
        W
      </div>
      <div style="min-width:0;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#e8b948;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          WynnPages Bespoke Demo &bull; Zero Monthly Fees
        </div>
        <div style="font-size:13px;font-weight:600;color:#fcf9f3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          Crafted for ${bizName.replace(/</g, '&lt;')}
        </div>
      </div>
    </div>
    <a id="wynnpages-claim-btn" href="${claimHref}" style="background:#96432b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:12px 20px;border-radius:13px;white-space:nowrap;flex-shrink:0;box-shadow:0 4px 14px rgba(150,67,43,0.45);transition:all 0.2s ease;display:inline-flex;align-items:center;gap:6px;">
      <span>Claim This Website &mdash; $599 AUD</span>
      <span>&rarr;</span>
    </a>
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
