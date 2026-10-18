const nodemailer = require('nodemailer');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Returns { send(to, details) } or null when email is not configured. */
function createMailer(cfg) {
  if (!cfg.email.user || !cfg.email.pass) return null;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.email.user, pass: cfg.email.pass },
  });

  return {
    async send(to, d) {
      const amount = Number(d.amount).toLocaleString('en-KE');
      await transporter.sendMail({
        from: `"PayLink" <${cfg.email.user}>`,
        to,
        subject: `Payment Received - KES ${amount}`,
        html: `
          <h2>Payment Received</h2>
          <p>You received a payment of <strong>KES ${escapeHtml(amount)}</strong>.</p>
          <p><strong>Receipt:</strong> ${escapeHtml(d.receipt || 'N/A')}</p>
          <p><strong>From:</strong> ${escapeHtml(d.phone)}</p>
          <p><strong>Description:</strong> ${escapeHtml(d.description)}</p>
          <p><strong>Time:</strong> ${escapeHtml(new Date(d.paidAt || Date.now()).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }))} (EAT)</p>
          <p><strong>Link:</strong> ${escapeHtml(d.linkUrl)}</p>`,
      });
    },
  };
}

module.exports = { createMailer, escapeHtml };
