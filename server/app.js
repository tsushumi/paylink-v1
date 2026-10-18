const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');

const { formatPhoneNumber, isValidKenyanPhone, maskPhone } = require('./lib/phone');
const { normalizeSlug, validateSlug, generateRandomSlug } = require('./lib/slug');
const { toCsv } = require('./lib/csv');
const { createLimiter } = require('./lib/rateLimit');
const { MpesaError } = require('./lib/mpesa');

const MAX_AMOUNT = 150000; // M-Pesa single transaction limit (KES)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAYMENT_STATUSES = ['pending', 'completed', 'failed', 'cancelled'];

/**
 * Builds the Express app. Dependencies are injected so the app can be tested
 * without a real database, Daraja, or SMTP server.
 *
 * @param {{ prisma, mpesa, mailer?, config, mockAutoCompleteMs?, pollFallbackAfterMs?, limits? }} deps
 */
function createApp(deps) {
  const { prisma, mpesa, mailer = null, config } = deps;
  const app = express();

  const phoneLimiter = createLimiter(deps.limits?.phone || { windowMs: 2 * 60 * 1000, max: 3 });
  const ipLimiter = createLimiter(deps.limits?.ip || { windowMs: 60 * 1000, max: 10 });

  app.use(cors());
  app.use(express.json({ limit: '50kb' }));

  // API responses must never be cached: browsers happily cache a 410 ("link inactive")
  // and would keep showing it after the link is reactivated.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const ok = (res, data, extra = {}) => res.json({ success: true, ...extra, data });
  const fail = (res, status, error) => res.status(status).json({ success: false, error });
  const isUniqueViolation = (err) => err && err.code === 'P2002';
  const linkUrl = (slug) => `${config.appUrl}/pay/${slug}`;

  // health
  app.get('/api/health', (req, res) => {
    res.json({ success: true, status: 'ok', mock: !!config.mock, time: new Date().toISOString() });
  });

  // payment links
  // Create a payment link
  app.post('/api/links', async (req, res) => {
    try {
      const { amount, description, slug, creatorEmail } = req.body || {};

      const amt = Number(amount);
      if (amount === undefined || amount === null || amount === '' || !Number.isFinite(amt) || amt < 1) {
        return fail(res, 400, 'Amount must be at least 1 KES.');
      }
      if (!Number.isInteger(amt)) return fail(res, 400, 'Amount must be a whole number of shillings.');
      if (amt > MAX_AMOUNT) return fail(res, 400, `Amount cannot be more than KES ${MAX_AMOUNT.toLocaleString()} (M-Pesa limit).`);

      const desc = typeof description === 'string' ? description.trim() : '';
      if (!desc) return fail(res, 400, 'Description is required.');
      if (desc.length > 120) return fail(res, 400, 'Description must be 120 characters or fewer.');

      let email = null;
      if (creatorEmail !== undefined && creatorEmail !== null && String(creatorEmail).trim() !== '') {
        email = String(creatorEmail).trim();
        if (!EMAIL_REGEX.test(email) || email.length > 254) return fail(res, 400, 'Please enter a valid notification email.');
      }

      let finalSlug;
      if (slug !== undefined && slug !== null && String(slug).trim() !== '') {
        finalSlug = normalizeSlug(slug);
        const slugError = validateSlug(finalSlug);
        if (slugError) return fail(res, 400, slugError);
      } else {
        finalSlug = generateRandomSlug();
      }

      const data = { slug: finalSlug, amount: amt, description: desc, creatorEmail: email };
      let link;
      try {
        // Random slugs can (very rarely) collide, so retry those a few times.
        const attempts = slug ? 1 : 5;
        for (let i = 0; i < attempts; i++) {
          try {
            link = await prisma.paymentLink.create({ data });
            break;
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            if (slug || i === attempts - 1) throw err;
            data.slug = generateRandomSlug();
          }
        }
      } catch (err) {
        if (isUniqueViolation(err)) {
          return fail(res, 409, `The custom link "${data.slug}" is already taken. Try a different one.`);
        }
        throw err;
      }

      return res.status(201).json({
        success: true,
        data: {
          id: link.id,
          slug: link.slug,
          amount: link.amount,
          description: link.description,
          url: `/pay/${link.slug}`,
          fullUrl: linkUrl(link.slug),
        },
      });
    } catch (error) {
      console.error('Create link error:', error);
      return fail(res, 500, 'Could not create the payment link. Please try again.');
    }
  });

  // List all payment links with stats
  app.get('/api/links', async (req, res) => {
    try {
      const links = await prisma.paymentLink.findMany({
        include: { payments: { select: { status: true, amount: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const data = links.map((link) => {
        const completed = link.payments.filter((p) => p.status === 'completed');
        return {
          id: link.id,
          slug: link.slug,
          amount: link.amount,
          description: link.description,
          active: link.active,
          creatorEmail: link.creatorEmail,
          totalPayments: completed.length, // successful payments
          totalAttempts: link.payments.length, // includes pending/failed/cancelled
          totalCollected: completed.reduce((sum, p) => sum + p.amount, 0),
          url: `/pay/${link.slug}`,
          fullUrl: linkUrl(link.slug),
          createdAt: link.createdAt,
        };
      });

      return ok(res, data);
    } catch (error) {
      console.error('List links error:', error);
      return fail(res, 500, 'Could not load payment links.');
    }
  });

  // Get a payment link by slug (public: used by the payment page)
  app.get('/api/links/:slug', async (req, res) => {
    try {
      const link = await prisma.paymentLink.findUnique({
        where: { slug: req.params.slug },
        include: { payments: { select: { status: true } } },
      });

      if (!link) return fail(res, 404, 'Payment link not found.');
      if (!link.active) return fail(res, 410, 'This payment link is no longer active.');

      return ok(res, {
        slug: link.slug,
        amount: link.amount,
        description: link.description,
        totalPayments: link.payments.filter((p) => p.status === 'completed').length,
      });
    } catch (error) {
      console.error('Get link error:', error);
      return fail(res, 500, 'Could not load the payment link.');
    }
  });

  // Bonus: activate / deactivate a link
  app.patch('/api/links/:slug', async (req, res) => {
    try {
      const { active } = req.body || {};
      if (typeof active !== 'boolean') return fail(res, 400, '"active" must be true or false.');

      const link = await prisma.paymentLink.findUnique({ where: { slug: req.params.slug } });
      if (!link) return fail(res, 404, 'Payment link not found.');

      const updated = await prisma.paymentLink.update({ where: { slug: link.slug }, data: { active } });
      return ok(res, { slug: updated.slug, active: updated.active });
    } catch (error) {
      console.error('Update link error:', error);
      return fail(res, 500, 'Could not update the payment link.');
    }
  });

  // Bonus: QR code for a link
  app.get('/api/links/:slug/qr', async (req, res) => {
    try {
      const link = await prisma.paymentLink.findUnique({ where: { slug: req.params.slug } });
      if (!link) return fail(res, 404, 'Link not found.');

      const url = linkUrl(link.slug);
      const qr = await QRCode.toDataURL(url, { width: 300, margin: 2 });
      return ok(res, { qr, url });
    } catch (error) {
      console.error('QR error:', error);
      return fail(res, 500, 'Could not generate the QR code.');
    }
  });

  // Bonus: export all payments of a link as CSV
  app.get('/api/links/:slug/payments.csv', async (req, res) => {
    try {
      const link = await prisma.paymentLink.findUnique({ where: { slug: req.params.slug } });
      if (!link) return fail(res, 404, 'Link not found.');

      const payments = await prisma.payment.findMany({
        where: { paymentLinkId: link.id },
        orderBy: { createdAt: 'desc' },
      });

      const csv = toCsv(
        ['Date', 'Receipt', 'Phone', 'Amount (KES)', 'Status', 'Description', 'Result'],
        payments.map((p) => [
          new Date(p.createdAt).toISOString(),
          p.mpesaReceiptNumber || '',
          maskPhone(p.phoneNumber),
          p.amount,
          p.status,
          link.description,
          p.resultDesc || '',
        ])
      );

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="paylink-${link.slug}-payments.csv"`);
      return res.send('﻿' + csv); // BOM so Excel reads UTF-8 properly
    } catch (error) {
      console.error('CSV export error:', error);
      return fail(res, 500, 'Could not export payments.');
    }
  });

  // payments
  // Core callback logic, shared by the real callback and the simulator.
  async function processCallback(body) {
    const cb = body && body.Body && body.Body.stkCallback;
    if (!cb || !cb.CheckoutRequestID) {
      console.warn('Callback ignored: unexpected payload shape');
      return { handled: false, reason: 'bad-payload' };
    }

    const checkoutRequestId = cb.CheckoutRequestID;
    const payment = await prisma.payment.findUnique({
      where: { checkoutRequestId },
      include: { paymentLink: true },
    });
    if (!payment) {
      console.warn(`Callback for unknown CheckoutRequestID ${checkoutRequestId}`);
      return { handled: false, reason: 'unknown-payment' };
    }

    const resultCode = Number(cb.ResultCode);
    const items = (cb.CallbackMetadata && Array.isArray(cb.CallbackMetadata.Item)) ? cb.CallbackMetadata.Item : [];
    const meta = {};
    for (const item of items) if (item && item.Name) meta[item.Name] = item.Value;

    // 0 = success, 1032 = cancelled by the customer, everything else = failed
    const status = resultCode === 0 ? 'completed' : resultCode === 1032 ? 'cancelled' : 'failed';

    if (status === 'completed' && meta.Amount !== undefined && Number(meta.Amount) !== Number(payment.amount)) {
      console.warn(`Amount mismatch for ${checkoutRequestId}: expected ${payment.amount}, got ${meta.Amount}`);
    }

    // Idempotency: only the first callback can move a payment out of "pending".
    // updateMany returns a count, so concurrent duplicate callbacks cannot both win.
    const result = await prisma.payment.updateMany({
      where: { checkoutRequestId, status: 'pending' },
      data: {
        status,
        resultCode: Number.isFinite(resultCode) ? resultCode : null,
        resultDesc: cb.ResultDesc ? String(cb.ResultDesc) : null,
        mpesaReceiptNumber: meta.MpesaReceiptNumber ? String(meta.MpesaReceiptNumber) : null,
        transactionDate: meta.TransactionDate !== undefined ? String(meta.TransactionDate) : null,
      },
    });

    if (result.count === 0) {
      console.log(`Duplicate callback ignored for ${checkoutRequestId}`);
      return { handled: true, duplicate: true, status: payment.status };
    }

    console.log(`Payment ${payment.id} -> ${status} (${cb.ResultDesc})`);

    // Bonus: email the link creator, or the default NOTIFY_EMAIL / EMAIL_USER inbox
    // (never blocks or breaks the callback response)
    const notifyTo = payment.paymentLink && (payment.paymentLink.creatorEmail || config.email.notifyTo);
    if (status === 'completed' && mailer && notifyTo) {
      mailer
        .send(notifyTo, {
          amount: payment.amount,
          receipt: meta.MpesaReceiptNumber,
          phone: maskPhone(payment.phoneNumber),
          description: payment.paymentLink.description,
          linkUrl: linkUrl(payment.paymentLink.slug),
          paidAt: new Date(),
        })
        .catch((err) => console.error('Payment email failed:', err.message));
    }

    return { handled: true, duplicate: false, status };
  }

  // Initiate STK Push
  app.post('/api/mpesa/stkpush', async (req, res) => {
    try {
      const { phoneNumber, amount, accountReference, transactionDesc, linkSlug } = req.body || {};

      if (!phoneNumber) return fail(res, 400, 'Phone number is required.');

      const formattedPhone = formatPhoneNumber(phoneNumber);
      if (!isValidKenyanPhone(formattedPhone)) {
        return fail(res, 400, 'Invalid phone number. Use a Safaricom number like 0712345678.');
      }

      // For payment links the AMOUNT COMES FROM THE DATABASE, never from the client,
      // otherwise anyone could pay KES 1 for a KES 15,000 invoice.
      let paymentLinkId = null;
      let payAmount;
      let reference = accountReference;
      let desc = transactionDesc;

      if (linkSlug) {
        const link = await prisma.paymentLink.findUnique({ where: { slug: String(linkSlug) } });
        if (!link) return fail(res, 404, 'Payment link not found.');
        if (!link.active) return fail(res, 410, 'This payment link is no longer active.');
        paymentLinkId = link.id;
        payAmount = link.amount;
        reference = link.slug;
        desc = 'PayLink';
      } else {
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt < 1) return fail(res, 400, 'Amount must be at least 1 KES.');
        if (!Number.isInteger(amt)) return fail(res, 400, 'Amount must be a whole number of shillings.');
        if (amt > MAX_AMOUNT) return fail(res, 400, `Amount cannot be more than KES ${MAX_AMOUNT.toLocaleString()}.`);
        payAmount = amt;
      }
      reference = String(reference || 'PayLink').slice(0, 12);
      desc = String(desc || 'Payment').slice(0, 13);

      // Stop people from spamming STK prompts at someone's phone.
      if (!phoneLimiter(formattedPhone) || !ipLimiter(req.ip)) {
        return fail(res, 429, 'Too many payment attempts. Please wait a couple of minutes and try again.');
      }

      const result = await mpesa.initiateSTKPush(formattedPhone, payAmount, reference, desc);

      const payment = await prisma.payment.create({
        data: {
          checkoutRequestId: result.CheckoutRequestID,
          merchantRequestId: result.MerchantRequestID,
          phoneNumber: formattedPhone,
          amount: payAmount,
          accountReference: reference,
          transactionDesc: desc,
          status: 'pending',
          paymentLinkId,
        },
      });

      // Mock mode: pretend the customer entered their PIN a few seconds later.
      if (config.mock && deps.mockAutoCompleteMs) {
        setTimeout(() => {
          processCallback(buildSimulatedCallback(payment, { success: true })).catch((e) => console.error(e));
        }, deps.mockAutoCompleteMs).unref?.();
      }

      return ok(res, { paymentId: payment.id, checkoutRequestId: result.CheckoutRequestID }, {
        message: 'STK Push sent. Check your phone.',
      });
    } catch (error) {
      console.error('STK Push error:', error.message);
      if (error instanceof MpesaError) return fail(res, error.status, error.message);
      return fail(res, 500, 'Something went wrong while starting the payment. Please try again.');
    }
  });

  // M-Pesa callback. Always answers 200 so Safaricom does not keep retrying.
  app.post('/api/mpesa/callback', async (req, res) => {
    const secret = config.mpesa.callbackSecret;
    if (secret && req.query.token !== secret) {
      console.warn('Callback rejected: bad token');
      return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
    }
    try {
      await processCallback(req.body);
    } catch (error) {
      console.error('Callback processing error:', error);
    }
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  // Poll payment status (what the payment page calls every few seconds)
  app.get('/api/payments/:id/poll', async (req, res) => {
    try {
      let payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!payment) return fail(res, 404, 'Payment not found.');

      // Safety net: if the callback never arrived (ngrok down, Safaricom delay) ask Daraja directly.
      const fallbackAfter = deps.pollFallbackAfterMs ?? 25000;
      const age = Date.now() - new Date(payment.createdAt).getTime();
      const sinceUpdate = Date.now() - new Date(payment.updatedAt).getTime();
      if (payment.status === 'pending' && !config.mock && age > fallbackAfter && sinceUpdate > 10000) {
        try {
          const q = await mpesa.queryStkStatus(payment.checkoutRequestId);
          if (q && q.ResultCode !== undefined && q.ResultCode !== null && q.ResultCode !== '') {
            await processCallback({
              Body: { stkCallback: { CheckoutRequestID: payment.checkoutRequestId, ResultCode: Number(q.ResultCode), ResultDesc: q.ResultDesc } },
            });
            payment = await prisma.payment.findUnique({ where: { id: payment.id } });
          }
        } catch (err) {
          if (!(err instanceof MpesaError && err.pending)) console.warn('STK query fallback failed:', err.message);
        }
      }

      return ok(res, {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        resultDesc: payment.resultDesc,
        mpesaReceiptNumber: payment.mpesaReceiptNumber,
        transactionDate: payment.transactionDate,
        createdAt: payment.createdAt,
      });
    } catch (error) {
      console.error('Poll error:', error);
      return fail(res, 500, 'Could not check the payment status.');
    }
  });

  // List all payments (dashboard). Optional ?status= and ?linkSlug= filters.
  app.get('/api/payments', async (req, res) => {
    try {
      const where = {};
      if (req.query.status) {
        if (!PAYMENT_STATUSES.includes(String(req.query.status))) return fail(res, 400, 'Unknown status filter.');
        where.status = String(req.query.status);
      }
      if (req.query.linkSlug) {
        const link = await prisma.paymentLink.findUnique({ where: { slug: String(req.query.linkSlug) } });
        if (!link) return ok(res, []);
        where.paymentLinkId = link.id;
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

      const payments = await prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { paymentLink: true },
      });

      return ok(res, payments.map((p) => ({
        id: p.id,
        phoneNumber: maskPhone(p.phoneNumber),
        amount: p.amount,
        status: p.status,
        resultDesc: p.resultDesc,
        mpesaReceiptNumber: p.mpesaReceiptNumber,
        linkSlug: p.paymentLink ? p.paymentLink.slug : null,
        linkDescription: p.paymentLink ? p.paymentLink.description : null,
        createdAt: p.createdAt,
      })));
    } catch (error) {
      console.error('List payments error:', error);
      return fail(res, 500, 'Could not load payments.');
    }
  });

  // Bonus-style helper: simulate Daraja's callback without a phone (mock / development only).
  function buildSimulatedCallback(payment, { success, resultCode, resultDesc }) {
    if (success) {
      return {
        Body: {
          stkCallback: {
            MerchantRequestID: payment.merchantRequestId,
            CheckoutRequestID: payment.checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'The service request is processed successfully.',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: payment.amount },
                { Name: 'MpesaReceiptNumber', Value: 'S' + Math.random().toString(36).slice(2, 11).toUpperCase() },
                { Name: 'TransactionDate', Value: Number(new Date().toISOString().replace(/\D/g, '').slice(0, 14)) },
                { Name: 'PhoneNumber', Value: Number(payment.phoneNumber) },
              ],
            },
          },
        },
      };
    }
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: payment.merchantRequestId,
          CheckoutRequestID: payment.checkoutRequestId,
          ResultCode: resultCode ?? 1032,
          ResultDesc: resultDesc || 'Request cancelled by user',
        },
      },
    };
  }

  app.post('/api/mpesa/simulate-callback', async (req, res) => {
    if (config.nodeEnv === 'production' && !config.mock) return fail(res, 404, 'Not found.');
    try {
      const { checkoutRequestId, paymentId, success = true, resultCode, resultDesc } = req.body || {};
      const payment = await prisma.payment.findUnique({
        where: checkoutRequestId ? { checkoutRequestId } : { id: paymentId || '' },
      });
      if (!payment) return fail(res, 404, 'Payment not found.');

      const outcome = await processCallback(buildSimulatedCallback(payment, { success: success !== false, resultCode, resultDesc }));
      return ok(res, outcome);
    } catch (error) {
      console.error('Simulate callback error:', error);
      return fail(res, 500, 'Could not simulate the callback.');
    }
  });

  // fallbacks
  app.use('/api', (req, res) => fail(res, 404, 'Endpoint not found.'));

  // Single-URL deployment: if the React app has been built (client/dist), serve it from here
  // so one Railway/Render service handles the site, the API and the M-Pesa callback.
  const distDir = deps.clientDist || path.join(__dirname, '..', 'client', 'dist');
  if (deps.serveClient !== false && fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON body.');
    console.error('Unhandled error:', err);
    return fail(res, 500, 'Internal server error.');
  });

  app.processCallback = processCallback;
  return app;
}

module.exports = { createApp, MAX_AMOUNT };
