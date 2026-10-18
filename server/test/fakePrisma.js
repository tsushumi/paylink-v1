// Minimal in-memory stand-in for the Prisma calls PayLink uses. Used ONLY by the test-suite
// (the real Prisma engine cannot be downloaded in the sandbox where this was built).
const crypto = require('crypto');

function cuid() {
  return 'c' + crypto.randomBytes(10).toString('hex');
}

function createFakePrisma() {
  const links = [];
  const payments = [];

  const uniqueError = (field) => Object.assign(new Error(`Unique constraint failed on ${field}`), { code: 'P2002' });
  const matches = (row, where = {}) => Object.entries(where).every(([k, v]) => row[k] === v);
  const sortDesc = (rows) => [...rows].sort((a, b) => b.createdAt - a.createdAt || (b._seq - a._seq));
  let seq = 0;

  const withPayments = (link, include) =>
    include && include.payments
      ? { ...link, payments: payments.filter((p) => p.paymentLinkId === link.id).map((p) => ({ ...p })) }
      : { ...link };
  const withLink = (p, include) =>
    include && include.paymentLink
      ? { ...p, paymentLink: links.find((l) => l.id === p.paymentLinkId) || null }
      : { ...p };

  return {
    _links: links,
    _payments: payments,
    paymentLink: {
      async findUnique({ where, include }) {
        const row = links.find((l) => matches(l, where));
        return row ? withPayments(row, include) : null;
      },
      async create({ data }) {
        if (links.some((l) => l.slug === data.slug)) throw uniqueError('slug');
        const now = new Date();
        const row = { id: cuid(), active: true, creatorEmail: null, ...data, createdAt: now, updatedAt: now, _seq: seq++ };
        links.push(row);
        return { ...row };
      },
      async update({ where, data }) {
        const row = links.find((l) => matches(l, where));
        if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      async findMany({ include, orderBy } = {}) {
        const rows = orderBy ? sortDesc(links) : [...links];
        return rows.map((l) => withPayments(l, include));
      },
    },
    payment: {
      async create({ data }) {
        if (payments.some((p) => p.checkoutRequestId === data.checkoutRequestId)) throw uniqueError('checkoutRequestId');
        const now = new Date();
        const row = {
          id: cuid(), merchantRequestId: null, accountReference: null, transactionDesc: null, status: 'pending',
          resultCode: null, resultDesc: null, mpesaReceiptNumber: null, transactionDate: null, paymentLinkId: null,
          ...data, createdAt: now, updatedAt: now, _seq: seq++,
        };
        payments.push(row);
        return { ...row };
      },
      async findUnique({ where, include }) {
        const row = payments.find((p) => matches(p, where));
        return row ? withLink(row, include) : null;
      },
      async updateMany({ where, data }) {
        const rows = payments.filter((p) => matches(p, where));
        rows.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
        return { count: rows.length };
      },
      async findMany({ where, orderBy, take, include } = {}) {
        let rows = payments.filter((p) => matches(p, where));
        if (orderBy) rows = sortDesc(rows);
        if (take) rows = rows.slice(0, take);
        return rows.map((p) => withLink(p, include));
      },
    },
  };
}

module.exports = { createFakePrisma };
