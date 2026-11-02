const fs = require('fs');

const key = process.env.STRIPE_SECRET_KEY || '';
fs.writeFileSync('stripe_key.js', `export const STRIPE_SECRET_KEY = ${JSON.stringify(key)};\n`);
console.log('[Build] stripe_key.js generated. Key length:', key ? key.length : 0);
