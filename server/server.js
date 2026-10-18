const { loadConfig, validateMpesaConfig } = require('./lib/config');
const { createMpesa } = require('./lib/mpesa');
const { createMailer } = require('./lib/email');
const prisma = require('./db');
const { createApp } = require('./app');

const config = loadConfig();
const app = createApp({
  prisma,
  mpesa: createMpesa(config),
  mailer: createMailer(config),
  config,
  mockAutoCompleteMs: config.mock ? 5000 : 0,
});

const server = app.listen(config.port, () => {
  console.log(`PayLink API running on http://localhost:${config.port}`);
  if (config.mock) {
    console.log('MPESA_MOCK=true: STK pushes are faked and auto-complete after ~5s.');
  } else {
    const missing = validateMpesaConfig(config);
    if (missing.length) console.warn(`Warning: M-Pesa settings missing or still placeholders: ${missing.join(', ')}`);
  }
  if (!createMailer(config)) console.log('Email notifications disabled (EMAIL_USER / EMAIL_APP_PASSWORD not set).');
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
