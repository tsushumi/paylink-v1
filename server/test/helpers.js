const { createApp } = require('../app');
const { loadConfig } = require('../lib/config');
const { createMpesa } = require('../lib/mpesa');
const { createFakePrisma } = require('./fakePrisma');

async function startTestApp(overrides = {}) {
  const config = loadConfig({ MPESA_MOCK: 'true', APP_URL: 'http://localhost:5173', NODE_ENV: 'test', ...overrides.env });
  const prisma = createFakePrisma();
  const sent = [];
  const mailer = overrides.noMailer ? null : { send: async (to, d) => { sent.push({ to, d }); } };
  const app = createApp({
    prisma,
    mpesa: overrides.mpesa || createMpesa(config),
    mailer,
    config,
    mockAutoCompleteMs: 0,
    limits: overrides.limits || { phone: { windowMs: 1000, max: 1000 }, ip: { windowMs: 1000, max: 1000 } },
    pollFallbackAfterMs: overrides.pollFallbackAfterMs,
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, body, raw = false) {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  return { app, prisma, sent, config, call, base, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { startTestApp };
