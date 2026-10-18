const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestApp } = require('./helpers');

async function makeLink(t, extra = {}) {
  const r = await t.call('POST', '/api/links', { amount: 1500, description: 'Logo design', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data;
}

test('create link: validation', async () => {
  const t = await startTestApp();
  try {
    const bad = [
      [{ description: 'x' }, /at least 1/],
      [{ amount: 0, description: 'x' }, /at least 1/],
      [{ amount: 'abc', description: 'x' }, /at least 1/],
      [{ amount: 10.5, description: 'x' }, /whole number/],
      [{ amount: 999999, description: 'x' }, /cannot be more/],
      [{ amount: 10, description: '   ' }, /Description is required/],
      [{ amount: 10, description: 'x'.repeat(121) }, /120/],
      [{ amount: 10, description: 'x', slug: 'a!' }, /3-50|lowercase/],
      [{ amount: 10, description: 'x', slug: 'dashboard' }, /reserved/],
      [{ amount: 10, description: 'x', creatorEmail: 'nope' }, /valid/],
    ];
    for (const [body, re] of bad) {
      const r = await t.call('POST', '/api/links', body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.success, false);
      assert.match(r.body.error, re);
    }
  } finally { await t.close(); }
});

test('create link: custom + random slug, duplicates', async () => {
  const t = await startTestApp();
  try {
    const a = await makeLink(t, { slug: 'Logo Design' });
    assert.equal(a.slug, 'logo-design');
    assert.equal(a.fullUrl, 'http://localhost:5173/pay/logo-design');
    const dup = await t.call('POST', '/api/links', { amount: 5, description: 'y', slug: 'logo-design' });
    assert.equal(dup.status, 409);
    assert.match(dup.body.error, /already taken/);
    const r = await makeLink(t);
    assert.match(r.slug, /^[a-z0-9]{8}$/);
  } finally { await t.close(); }
});

test('get link: 200 / 404 / 410', async () => {
  const t = await startTestApp();
  try {
    const l = await makeLink(t, { slug: 'rent' });
    const ok = await t.call('GET', '/api/links/rent');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.amount, 1500);
    assert.equal((await t.call('GET', '/api/links/nope')).status, 404);
    await t.call('PATCH', '/api/links/rent', { active: false });
    const gone = await t.call('GET', '/api/links/rent');
    assert.equal(gone.status, 410);
    assert.match(gone.body.error, /no longer active/);
    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'rent' });
    assert.equal(push.status, 410);
    await t.call('PATCH', '/api/links/rent', { active: true });
    assert.equal((await t.call('GET', '/api/links/rent')).status, 200);
    assert.equal((await t.call('PATCH', '/api/links/rent', { active: 'yes' })).status, 400);
    assert.equal((await t.call('PATCH', '/api/links/zzz', { active: true })).status, 404);
    void l;
  } finally { await t.close(); }
});

test('stk push: validation and amount comes from the DB', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'invoice-1' });
    assert.equal((await t.call('POST', '/api/mpesa/stkpush', { linkSlug: 'invoice-1' })).status, 400);
    const bad = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '12345', linkSlug: 'invoice-1' });
    assert.equal(bad.status, 400);
    assert.equal((await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'missing' })).status, 404);

    // Client tries to underpay: amount 1 is ignored, DB amount (1500) is charged.
    const r = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', amount: 1, linkSlug: 'invoice-1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const pay = t.prisma._payments[0];
    assert.equal(pay.amount, 1500);
    assert.equal(pay.phoneNumber, '254712345678');
    assert.equal(pay.status, 'pending');
    assert.ok(pay.paymentLinkId);

    // Without a link, amount is validated.
    assert.equal((await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', amount: 0 })).status, 400);
    assert.equal((await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', amount: 20 })).status, 200);
  } finally { await t.close(); }
});

test('full flow: push -> poll pending -> callback success -> poll completed -> dashboard', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'wedding', creatorEmail: 'me@example.com' });
    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'wedding' });
    const { paymentId, checkoutRequestId } = push.body.data;

    const pending = await t.call('GET', `/api/payments/${paymentId}/poll`);
    assert.equal(pending.body.data.status, 'pending');

    const cb = {
      Body: { stkCallback: {
        MerchantRequestID: 'm', CheckoutRequestID: checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
        CallbackMetadata: { Item: [
          { Name: 'Amount', Value: 1500 }, { Name: 'MpesaReceiptNumber', Value: 'QWE123' },
          { Name: 'TransactionDate', Value: 20261016120000 }, { Name: 'PhoneNumber', Value: 254712345678 },
        ] },
      } },
    };
    const r = await t.call('POST', '/api/mpesa/callback', cb);
    assert.equal(r.status, 200);
    assert.equal(r.body.ResultCode, 0);

    const done = await t.call('GET', `/api/payments/${paymentId}/poll`);
    assert.equal(done.body.data.status, 'completed');
    assert.equal(done.body.data.mpesaReceiptNumber, 'QWE123');

    // email sent once, phone masked
    await new Promise((r2) => setImmediate(r2));
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, 'me@example.com');
    assert.equal(t.sent[0].d.phone, '2547****5678');

    const links = await t.call('GET', '/api/links');
    assert.equal(links.body.data[0].totalPayments, 1);
    assert.equal(links.body.data[0].totalCollected, 1500);

    const list = await t.call('GET', '/api/payments');
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].phoneNumber, '2547****5678');
    assert.equal(list.body.data[0].linkSlug, 'wedding');
  } finally { await t.close(); }
});

test('callback idempotency: duplicate callbacks do not double count or double email', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'dup', creatorEmail: 'me@example.com' });
    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'dup' });
    const body = { Body: { stkCallback: { CheckoutRequestID: push.body.data.checkoutRequestId, ResultCode: 0, ResultDesc: 'ok',
      CallbackMetadata: { Item: [{ Name: 'MpesaReceiptNumber', Value: 'FIRST' }] } } } };
    await Promise.all([t.call('POST', '/api/mpesa/callback', body), t.call('POST', '/api/mpesa/callback', body)]);
    body.Body.stkCallback.CallbackMetadata.Item[0].Value = 'SECOND';
    await t.call('POST', '/api/mpesa/callback', body);
    // a late failure must not flip a completed payment
    await t.call('POST', '/api/mpesa/callback', { Body: { stkCallback: { CheckoutRequestID: push.body.data.checkoutRequestId, ResultCode: 1, ResultDesc: 'late' } } });
    await new Promise((r) => setImmediate(r));
    const p = t.prisma._payments[0];
    assert.equal(p.status, 'completed');
    assert.equal(p.mpesaReceiptNumber, 'FIRST');
    assert.equal(t.sent.length, 1);
  } finally { await t.close(); }
});

test('callback: cancelled (1032), failed, junk payloads, unknown ids', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'cancel-link' });
    const a = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'cancel-link' });
    await t.call('POST', '/api/mpesa/callback', { Body: { stkCallback: { CheckoutRequestID: a.body.data.checkoutRequestId, ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } });
    assert.equal((await t.call('GET', `/api/payments/${a.body.data.paymentId}/poll`)).body.data.status, 'cancelled');

    const b = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0722345678', linkSlug: 'cancel-link' });
    await t.call('POST', '/api/mpesa/callback', { Body: { stkCallback: { CheckoutRequestID: b.body.data.checkoutRequestId, ResultCode: 1, ResultDesc: 'Insufficient funds' } } });
    const pb = await t.call('GET', `/api/payments/${b.body.data.paymentId}/poll`);
    assert.equal(pb.body.data.status, 'failed');
    assert.equal(pb.body.data.resultDesc, 'Insufficient funds');

    for (const junk of [{}, { Body: {} }, { Body: { stkCallback: { CheckoutRequestID: 'unknown', ResultCode: 0 } } }]) {
      const r = await t.call('POST', '/api/mpesa/callback', junk);
      assert.equal(r.status, 200);
    }
    const links = await t.call('GET', '/api/links');
    assert.equal(links.body.data[0].totalPayments, 0);
    assert.equal(links.body.data[0].totalAttempts, 2);
    assert.equal((await t.call('GET', '/api/payments/nope/poll')).status, 404);
  } finally { await t.close(); }
});

test('callback secret token is enforced when configured', async () => {
  const t = await startTestApp({ env: { MPESA_CALLBACK_SECRET: 's3cret' } });
  try {
    assert.equal((await t.call('POST', '/api/mpesa/callback', {})).status, 403);
    assert.equal((await t.call('POST', '/api/mpesa/callback?token=s3cret', {})).status, 200);
  } finally { await t.close(); }
});

test('simulate-callback works (success and failure)', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'sim' });
    const p1 = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'sim' });
    const s = await t.call('POST', '/api/mpesa/simulate-callback', { paymentId: p1.body.data.paymentId });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const poll = await t.call('GET', `/api/payments/${p1.body.data.paymentId}/poll`);
    assert.equal(poll.body.data.status, 'completed');
    assert.ok(poll.body.data.mpesaReceiptNumber);

    const p2 = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0722345678', linkSlug: 'sim' });
    await t.call('POST', '/api/mpesa/simulate-callback', { checkoutRequestId: p2.body.data.checkoutRequestId, success: false });
    assert.equal((await t.call('GET', `/api/payments/${p2.body.data.paymentId}/poll`)).body.data.status, 'cancelled');
    assert.equal((await t.call('POST', '/api/mpesa/simulate-callback', { paymentId: 'zzz' })).status, 404);
  } finally { await t.close(); }
});

test('rate limiting per phone number', async () => {
  const t = await startTestApp({ limits: { phone: { windowMs: 60000, max: 2 }, ip: { windowMs: 60000, max: 100 } } });
  try {
    await makeLink(t, { slug: 'rate-link' });
    const go = () => t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'rate-link' });
    assert.equal((await go()).status, 200);
    assert.equal((await go()).status, 200);
    const third = await go();
    assert.equal(third.status, 429);
  } finally { await t.close(); }
});

test('M-Pesa failures are surfaced as friendly errors', async () => {
  const { MpesaError } = require('../lib/mpesa');
  const mpesa = { initiateSTKPush: async () => { throw new MpesaError('M-Pesa could not process the request. Please try again.'); }, queryStkStatus: async () => ({}) };
  const t = await startTestApp({ mpesa });
  try {
    await makeLink(t, { slug: 'err' });
    const r = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'err' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /could not process/);
    assert.equal(t.prisma._payments.length, 0);
  } finally { await t.close(); }
});

test('poll falls back to STK Query when the callback never arrives', async () => {
  const mpesa = {
    initiateSTKPush: async () => ({ CheckoutRequestID: 'ws_CO_1', MerchantRequestID: 'm1' }),
    queryStkStatus: async () => ({ ResultCode: '0', ResultDesc: 'ok' }),
  };
  const t = await startTestApp({ env: { MPESA_MOCK: 'false', MPESA_CONSUMER_KEY: 'k', MPESA_CONSUMER_SECRET: 's', MPESA_PASSKEY: 'p', MPESA_CALLBACK_URL: 'https://x.test/cb' }, mpesa, pollFallbackAfterMs: 0 });
  try {
    await makeLink(t, { slug: 'fallback-link' });
    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'fallback-link' });
    // age the payment so the fallback kicks in
    t.prisma._payments[0].updatedAt = new Date(Date.now() - 60000);
    const poll = await t.call('GET', `/api/payments/${push.body.data.paymentId}/poll`);
    assert.equal(poll.body.data.status, 'completed');
  } finally { await t.close(); }
});

test('QR code + CSV export + QR 404', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'qr-test' });
    const qr = await t.call('GET', '/api/links/qr-test/qr');
    assert.equal(qr.status, 200);
    assert.match(qr.body.data.qr, /^data:image\/png;base64,/);
    assert.equal(qr.body.data.url, 'http://localhost:5173/pay/qr-test');
    assert.equal((await t.call('GET', '/api/links/nope/qr')).status, 404);

    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'qr-test' });
    await t.call('POST', '/api/mpesa/simulate-callback', { paymentId: push.body.data.paymentId });
    const res = await t.call('GET', '/api/links/qr-test/payments.csv', null, true);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /paylink-qr-test-payments\.csv/);
    const text = await res.text();
    assert.match(text, /Date,Receipt,Phone,Amount \(KES\),Status/);
    assert.match(text, /2547\*\*\*\*5678,1500,completed/);
    assert.equal((await t.call('GET', '/api/links/nope/payments.csv')).status, 404);
  } finally { await t.close(); }
});

test('misc: health, unknown api route, bad json', async () => {
  const t = await startTestApp();
  try {
    assert.equal((await t.call('GET', '/api/health')).body.status, 'ok');
    assert.equal((await t.call('GET', '/api/nothing')).status, 404);
    const res = await fetch(t.base + '/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(res.status, 400);
    assert.equal((await t.call('GET', '/api/payments?status=weird')).status, 400);
  } finally { await t.close(); }
});

test('API responses are never cacheable (410 must not stick after reactivation)', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'cache-me' });
    await t.call('PATCH', '/api/links/cache-me', { active: false });
    const res = await t.call('GET', '/api/links/cache-me', null, true);
    assert.equal(res.status, 410);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  } finally { await t.close(); }
});

test('email: default recipient fallback and timestamp', async () => {
  const t = await startTestApp({ env: { NOTIFY_EMAIL: 'owner@example.com' } });
  try {
    await makeLink(t, { slug: 'no-email-link' }); // no creatorEmail on the link
    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'no-email-link' });
    await t.call('POST', '/api/mpesa/simulate-callback', { paymentId: push.body.data.paymentId });
    await new Promise((r) => setImmediate(r));
    assert.equal(t.sent.length, 1);
    assert.equal(t.sent[0].to, 'owner@example.com');
    assert.ok(t.sent[0].d.paidAt instanceof Date);
    assert.equal(t.sent[0].d.phone, '2547****5678');
  } finally { await t.close(); }
});

test('no recipient configured -> no email, payment still completes', async () => {
  const t = await startTestApp();
  try {
    await makeLink(t, { slug: 'quiet-link' });
    const push = await t.call('POST', '/api/mpesa/stkpush', { phoneNumber: '0712345678', linkSlug: 'quiet-link' });
    await t.call('POST', '/api/mpesa/simulate-callback', { paymentId: push.body.data.paymentId });
    await new Promise((r) => setImmediate(r));
    assert.equal(t.sent.length, 0);
    assert.equal(t.prisma._payments[0].status, 'completed');
  } finally { await t.close(); }
});
