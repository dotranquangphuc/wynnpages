export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 2. Stripe Checkout Session Endpoint
    if (url.pathname === '/api/create-checkout-session' && request.method === 'POST') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      };

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

        const stripeSecretKey = env.STRIPE_SECRET_KEY;
        if (!stripeSecretKey) {
          const keys = Object.keys(env || {}).join(', ');
          return new Response(
            JSON.stringify({
              error: `STRIPE_SECRET_KEY is not configured in Cloudflare environment variables. (Detected env keys: [${keys}])`
            }),
            { status: 500, headers: corsHeaders }
          );
        }

        const origin = url.origin;
        const baseBriefUrl = env.TALLY_BRIEF_URL || `${origin}/brief?type=organic`;
        const separator = baseBriefUrl.includes('?') ? '&' : '?';
        const successUrl = `${baseBriefUrl}${separator}session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`;
        const cancelUrl = `${origin}/?canceled=true`;

        const params = new URLSearchParams();
        params.append('mode', 'payment');
        params.append('customer_email', email);
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('payment_method_types[0]', 'card');
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
            'Authorization': `Bearer ${stripeSecretKey}`,
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

    // 3. Default static assets fetch
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  }
};
