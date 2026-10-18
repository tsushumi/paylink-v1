const crypto = require('crypto');

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_LEN = 3;
const MAX_LEN = 50;
// Slugs that would clash with app routes / look official.
const RESERVED = new Set(['create', 'dashboard', 'pay', 'api', 'admin', 'new', 'login']);

/** Lowercase, trim and turn spaces/underscores into dashes. Does NOT silently drop other characters. */
function normalizeSlug(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Returns an error message, or null when the slug is fine. */
function validateSlug(slug) {
  if (slug.length < MIN_LEN || slug.length > MAX_LEN) {
    return `Custom link must be ${MIN_LEN}-${MAX_LEN} characters long.`;
  }
  if (!SLUG_REGEX.test(slug)) {
    return 'Custom link can only contain lowercase letters, numbers, and single dashes.';
  }
  if (RESERVED.has(slug)) {
    return `"${slug}" is a reserved word. Try a different custom link.`;
  }
  return null;
}

function generateRandomSlug(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) slug += chars[bytes[i] % chars.length];
  return slug;
}

module.exports = { normalizeSlug, validateSlug, generateRandomSlug, SLUG_REGEX, MIN_LEN, MAX_LEN };
