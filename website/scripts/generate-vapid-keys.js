// One-time script to generate VAPID keys for Web Push.
// Run: cd website && node scripts/generate-vapid-keys.js
// Then add both lines to .env.local AND to Vercel env vars.

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('NEXT_PUBLIC_VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
