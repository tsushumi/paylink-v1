const axios = require('axios');
const crypto = require('crypto');
const { validateMpesaConfig } = require('./config');

class MpesaError extends Error {
  constructor(message, { status = 502, pending = false, details } = {}) {
    super(message);
    this.name = 'MpesaError';
    this.status = status;
    this.pending = pending; // true when Daraja says "transaction is still being processed"
    this.details = details;
  }
}

/** YYYYMMDDHHmmss in Nairobi time (UTC+3). */
function getTimestamp(date = new Date()) {
  const nairobi = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return nairobi.toISOString().replace(/\D/g, '').slice(0, 14);
}

function generatePassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

function createMpesa(cfg, http = axios) {
  const m = cfg.mpesa;
  let cached = { token: null, expiresAt: 0 };
  let inflight = null;

  function assertConfigured() {
    const missing = validateMpesaConfig(cfg);
    if (missing.length) {
      throw new MpesaError(`M-Pesa is not configured on the server (missing: ${missing.join(', ')}).`, { status: 503 });
    }
  }

  async function getAccessToken() {
    if (cfg.mock) return 'mock-token';
    assertConfigured();
    // 60s safety buffer so we never use a token that expires mid-request.
    if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;
    if (inflight) return inflight; // de-duplicate concurrent token requests

    inflight = (async () => {
      try {
        const auth = Buffer.from(`${m.consumerKey}:${m.consumerSecret}`).toString('base64');
        const { data } = await http.get(`${m.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
          headers: { Authorization: `Basic ${auth}` },
          timeout: 15000,
        });
        if (!data || !data.access_token) throw new Error('No access_token in Daraja response');
        cached = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3599) * 1000 };
        return cached.token;
      } catch (err) {
        console.error('Daraja OAuth failed:', err.response?.data || err.message);
        throw new MpesaError('Could not authenticate with M-Pesa. Please try again shortly.', { details: err.response?.data });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /** Daraja limits: AccountReference <= 12 chars, TransactionDesc <= 13 chars. */
  async function initiateSTKPush(phone, amount, accountReference = 'PayLink', transactionDesc = 'Payment') {
    if (cfg.mock) {
      const id = crypto.randomBytes(6).toString('hex');
      return {
        MerchantRequestID: `mock-merchant-${id}`,
        CheckoutRequestID: `ws_CO_MOCK_${Date.now()}_${id}`,
        ResponseCode: '0',
        ResponseDescription: 'Success. Request accepted for processing (mock)',
        CustomerMessage: 'Success. Request accepted for processing',
      };
    }
    assertConfigured();
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const callbackUrl = m.callbackSecret
      ? `${m.callbackUrl}${m.callbackUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(m.callbackSecret)}`
      : m.callbackUrl;

    try {
      const { data } = await http.post(
        `${m.baseUrl}/mpesa/stkpush/v1/processrequest`,
        {
          BusinessShortCode: m.shortcode,
          Password: generatePassword(m.shortcode, m.passkey, timestamp),
          Timestamp: timestamp,
          TransactionType: 'CustomerPayBillOnline',
          Amount: Math.round(Number(amount)),
          PartyA: phone,
          PartyB: m.shortcode,
          PhoneNumber: phone,
          CallBackURL: callbackUrl,
          AccountReference: String(accountReference).slice(0, 12),
          TransactionDesc: String(transactionDesc).slice(0, 13),
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
      );
      if (String(data.ResponseCode) !== '0') {
        throw new MpesaError(data.ResponseDescription || 'M-Pesa rejected the request.', { details: data });
      }
      return data;
    } catch (err) {
      if (err instanceof MpesaError) throw err;
      const body = err.response?.data;
      console.error('STK Push failed:', body || err.message);
      if (err.response?.status === 401) cached = { token: null, expiresAt: 0 }; // force refresh next time
      throw new MpesaError(body?.errorMessage || 'M-Pesa could not process the request. Please try again.', { details: body });
    }
  }

  /** Ask Daraja what happened to an STK push (fallback when the callback never arrives). */
  async function queryStkStatus(checkoutRequestId) {
    if (cfg.mock) return { ResultCode: '1037', ResultDesc: 'Mock: no result yet' };
    assertConfigured();
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    try {
      const { data } = await http.post(
        `${m.baseUrl}/mpesa/stkpushquery/v1/query`,
        {
          BusinessShortCode: m.shortcode,
          Password: generatePassword(m.shortcode, m.passkey, timestamp),
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId,
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      return data;
    } catch (err) {
      const body = err.response?.data;
      // While the customer has not yet acted, Daraja answers HTTP 500 "being processed".
      if (body && /being processed/i.test(body.errorMessage || '')) {
        throw new MpesaError('Transaction is still being processed.', { pending: true, details: body });
      }
      throw new MpesaError('Could not query M-Pesa for the payment status.', { details: body });
    }
  }

  return { getAccessToken, initiateSTKPush, queryStkStatus };
}

module.exports = { createMpesa, getTimestamp, generatePassword, MpesaError };
