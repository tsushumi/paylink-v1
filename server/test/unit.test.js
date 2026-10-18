const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPhoneNumber, isValidKenyanPhone, maskPhone } = require('../lib/phone');
const { normalizeSlug, validateSlug, generateRandomSlug } = require('../lib/slug');
const { getTimestamp, generatePassword } = require('../lib/mpesa');
const { toCsv, csvCell } = require('../lib/csv');
const { escapeHtml } = require('../lib/email');
const { loadConfig, validateMpesaConfig } = require('../lib/config');

test('formatPhoneNumber handles common Kenyan formats', () => {
  for (const input of ['0712345678', '712345678', '+254712345678', '254712345678', '0712 345 678', '0712-345-678']) {
    assert.equal(formatPhoneNumber(input), '254712345678', input);
  }
  assert.equal(formatPhoneNumber('0112345678'), '254112345678');
  assert.equal(formatPhoneNumber(undefined), '');
});

test('isValidKenyanPhone', () => {
  assert.ok(isValidKenyanPhone('254712345678'));
  assert.ok(isValidKenyanPhone('254112345678'));
  for (const bad of ['254212345678', '25471234567', '2547123456789', 'abc', '', null, '0712345678']) {
    assert.equal(isValidKenyanPhone(bad), false, String(bad));
  }
});

test('maskPhone', () => assert.equal(maskPhone('254712345678'), '2547****5678'));

test('slug normalise + validate', () => {
  assert.equal(normalizeSlug('  Logo Design_2026 '), 'logo-design-2026');
  assert.equal(validateSlug('logo-design'), null);
  assert.match(validateSlug('ab'), /3-50/);
  assert.match(validateSlug('bad!slug'), /lowercase letters/);
  assert.match(validateSlug('create'), /reserved/);
  assert.match(validateSlug('a'.repeat(51)), /3-50/);
  assert.match(generateRandomSlug(), /^[a-z0-9]{8}$/);
});

test('timestamp is 14 digits, Nairobi time', () => {
  const ts = getTimestamp(new Date('2026-10-16T21:30:00Z'));
  assert.equal(ts, '20261017003000'); // 21:30 UTC = 00:30 next day in Nairobi
});

test('password is base64(shortcode+passkey+timestamp)', () => {
  const pw = generatePassword('174379', 'key', '20260101000000');
  assert.equal(Buffer.from(pw, 'base64').toString(), '174379key20260101000000');
});

test('csv escaping + formula injection guard', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(toCsv(['a', 'b'], [[1, 'x']]), 'a,b\r\n1,x\r\n');
});

test('escapeHtml', () => assert.equal(escapeHtml('<b>"x"&</b>'), '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;'));

test('validateMpesaConfig flags placeholders', () => {
  const cfg = loadConfig({ MPESA_CONSUMER_KEY: 'your_consumer_key', MPESA_CALLBACK_URL: 'https://x.ngrok.app/cb' });
  const missing = validateMpesaConfig(cfg);
  assert.ok(missing.includes('MPESA_CONSUMER_KEY'));
  assert.ok(missing.includes('MPESA_PASSKEY'));
  assert.ok(!missing.includes('MPESA_CALLBACK_URL'));
});
