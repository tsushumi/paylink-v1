// Small fetch wrapper: always resolves to the server's { success, data, error } shape,
// even when the network is down or the server sends something that is not JSON.
export async function api(path, options = {}) {
  try {
    const response = await fetch(path, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const result = await response.json().catch(() => null);
    if (!result) return { success: false, status: response.status, error: 'Unexpected response from the server.' };
    return { status: response.status, ...result };
  } catch {
    return { success: false, status: 0, error: 'Cannot reach the server. Check your connection and try again.' };
  }
}

export const formatKES = (n) => `KES ${Number(n || 0).toLocaleString('en-KE')}`;

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (e.g. opened over plain http on a phone).
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(el);
    return ok;
  }
}
