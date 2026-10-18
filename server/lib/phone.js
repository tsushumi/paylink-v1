// Kenyan phone number helpers (Safaricom 07xx / 01xx numbers).

/**
 * Normalise common Kenyan formats to the 2547XXXXXXXX / 2541XXXXXXXX form Daraja expects.
 * Accepts: 0712345678, 712345678, +254712345678, 254712345678, "0712 345 678", "0712-345-678".
 * Returns a string (which may still be invalid - check with isValidKenyanPhone).
 */
function formatPhoneNumber(input) {
  let phone = String(input ?? '').trim().replace(/[\s\-().]/g, '');
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (phone.startsWith('0')) phone = '254' + phone.slice(1);
  else if (/^[17]\d{8}$/.test(phone)) phone = '254' + phone;
  return phone;
}

function isValidKenyanPhone(phone) {
  return /^254[17]\d{8}$/.test(String(phone ?? ''));
}

/** 254712345678 -> 2547****5678 (safe for lists, logs, CSV). */
function maskPhone(phone) {
  const p = String(phone ?? '');
  if (p.length < 9) return '***';
  return p.slice(0, 4) + '****' + p.slice(-4);
}

module.exports = { formatPhoneNumber, isValidKenyanPhone, maskPhone };
