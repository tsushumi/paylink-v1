require('dotenv').config();

function loadConfig(env = process.env) {
  const mock = String(env.MPESA_MOCK).toLowerCase() === 'true';
  const mpesaEnv = env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
  return {
    port: Number(env.PORT) || 3000,
    appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
    nodeEnv: env.NODE_ENV || 'development',
    mock,
    mpesa: {
      env: mpesaEnv,
      baseUrl: mpesaEnv === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
      consumerKey: env.MPESA_CONSUMER_KEY,
      consumerSecret: env.MPESA_CONSUMER_SECRET,
      shortcode: env.MPESA_SHORTCODE || '174379',
      passkey: env.MPESA_PASSKEY,
      callbackUrl: env.MPESA_CALLBACK_URL,
      // Optional shared secret appended to the callback URL as ?token=... so random
      // internet traffic cannot mark payments as paid.
      callbackSecret: env.MPESA_CALLBACK_SECRET || '',
    },
    email: { user: env.EMAIL_USER, pass: env.EMAIL_APP_PASSWORD, notifyTo: env.NOTIFY_EMAIL || env.EMAIL_USER },
  };
}

const PLACEHOLDER = /^(your_|https:\/\/your-)/;

/** Returns the list of missing/placeholder Daraja settings. */
function validateMpesaConfig(cfg) {
  const m = cfg.mpesa;
  const required = {
    MPESA_CONSUMER_KEY: m.consumerKey,
    MPESA_CONSUMER_SECRET: m.consumerSecret,
    MPESA_SHORTCODE: m.shortcode,
    MPESA_PASSKEY: m.passkey,
    MPESA_CALLBACK_URL: m.callbackUrl,
  };
  return Object.entries(required)
    .filter(([, v]) => !v || PLACEHOLDER.test(String(v)))
    .map(([k]) => k);
}

module.exports = { loadConfig, validateMpesaConfig };
