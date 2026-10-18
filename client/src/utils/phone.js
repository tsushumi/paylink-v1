// Phone helpers for the payment form (mirror the server rules in server/lib/phone.js).

/** Keep only characters that can appear in a phone number while typing. */
export function formatPhoneHint(value) {
  return value.replace(/[^\d+\s-]/g, '');
}

/** Accepts 0712345678, 712345678, +254712345678, 254712345678 (also 01xx numbers). */
export function looksValid(value) {
  const p = value.replace(/[\s-]/g, '').replace(/^\+/, '');
  return /^(0|254)?[17]\d{8}$/.test(p);
}

/** 254712345678 -> 2547****5678 */
export function maskPhone(phone) {
  const p = String(phone ?? '');
  return p.length < 9 ? '***' : `${p.slice(0, 4)}****${p.slice(-4)}`;
}
