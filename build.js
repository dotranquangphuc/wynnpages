const fs = require('fs');

const envVars = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  CLICKSEND_USERNAME: process.env.CLICKSEND_USERNAME || '',
  CLICKSEND_API_KEY: process.env.CLICKSEND_API_KEY || '',
  CLICKSEND_FROM: process.env.CLICKSEND_FROM || '',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || '',
  ADMIN_KEY: process.env.ADMIN_KEY || '',
  ADMIN_NOTIFY_EMAIL: process.env.ADMIN_NOTIFY_EMAIL || '',
  ADMIN_NOTIFY_PHONE: process.env.ADMIN_NOTIFY_PHONE || ''
};

const lines = Object.entries(envVars).map(
  ([k, v]) => `export const ${k} = ${JSON.stringify(v)};`
);

fs.writeFileSync('stripe_key.js', lines.join('\n') + '\n');
console.log('[Build] stripe_key.js generated. Configured keys:', Object.keys(envVars).filter(k => Boolean(envVars[k])).join(', ') || 'none');
