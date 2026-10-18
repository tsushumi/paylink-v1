import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, copyText, formatKES } from '../api';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const input =
  'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none';

// Mirrors the server's normalisation so the preview matches the final link.
function normalizeSlug(value) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

function slugProblem(raw) {
  if (!raw.trim()) return '';
  const s = normalizeSlug(raw);
  if (s.length < 3) return 'Use at least 3 characters.';
  if (s.length > 50) return 'Use 50 characters or fewer.';
  if (!SLUG_RE.test(s)) return 'Only lowercase letters, numbers, and single dashes are allowed.';
  if (['create', 'dashboard', 'pay', 'api', 'admin', 'new', 'login'].includes(s)) return `"${s}" is reserved.`;
  return '';
}

export default function CreateLink() {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [createdLink, setCreatedLink] = useState(null);
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const problem = slugProblem(slug);
  const previewSlug = slug.trim() ? normalizeSlug(slug) : 'random-link';

  useEffect(() => {
    if (!createdLink) return undefined;
    let cancelled = false;
    api(`/api/links/${createdLink.slug}/qr`).then((r) => {
      if (!cancelled && r.success) setQr(r.data.qr);
    });
    return () => { cancelled = true; };
  }, [createdLink]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (problem) return setError(problem);

    setLoading(true);
    const result = await api('/api/links', {
      method: 'POST',
      body: {
        amount: Number(amount),
        description,
        slug: slug.trim() || undefined,
        creatorEmail: email.trim() || undefined,
      },
    });
    setLoading(false);

    if (!result.success) return setError(result.error);
    setCreatedLink(result.data);
  }

  const fullUrl = createdLink ? `${window.location.origin}/pay/${createdLink.slug}` : '';

  async function handleCopy() {
    if (await copyText(fullUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function reset() {
    setCreatedLink(null);
    setQr('');
    setAmount('');
    setDescription('');
    setSlug('');
    setEmail('');
    setError('');
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Payment Link</h1>

      {createdLink ? (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h2 className="text-lg font-semibold text-green-600 mb-1">Payment link created</h2>
          <p className="text-sm text-gray-500 mb-4">
            {formatKES(createdLink.amount)} &middot; {createdLink.description}
          </p>

          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-500 mb-1">Share this link:</p>
            <p className="font-mono text-sm break-all text-gray-900">{fullUrl}</p>
          </div>

          {qr && (
            <div className="flex flex-col items-center mb-4">
              <img src={qr} alt={`QR code for ${fullUrl}`} width="200" height="200" className="rounded-lg border border-gray-200" />
              <a href={qr} download={`paylink-${createdLink.slug}.png`} className="text-sm text-green-600 hover:underline mt-2">
                Download QR code
              </a>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleCopy} className="flex-1 bg-green-600 text-white py-2 rounded-lg font-medium hover:bg-green-700 transition-colors">
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
            <button onClick={reset} className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors">
              Create Another
            </button>
          </div>
          <div className="flex justify-between mt-4 text-sm">
            <Link to={`/pay/${createdLink.slug}`} className="text-green-600 hover:underline">Open payment page</Link>
            <Link to="/dashboard" className="text-gray-500 hover:underline">Go to dashboard</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-6 space-y-4" noValidate>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Amount (KES)</label>
            <input id="amount" type="number" inputMode="numeric" min="1" step="1" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="1500" className={input} required />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <input id="description" type="text" maxLength={120} value={description}
              onChange={(e) => setDescription(e.target.value)} placeholder="Invoice #1042 - Web design" className={input} required />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">Custom Link (optional)</label>
            <div className="flex items-center">
              <span className="text-gray-400 text-sm mr-2">/pay/</span>
              <input id="slug" type="text" value={slug} onChange={(e) => setSlug(e.target.value)}
                placeholder="logo-design" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                aria-invalid={!!problem}
                className={`flex-1 px-4 py-3 border rounded-lg focus:ring-2 outline-none ${problem ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 focus:ring-green-500 focus:border-green-500'}`} />
            </div>
            {problem ? (
              <p className="text-red-600 text-xs mt-1">{problem}</p>
            ) : (
              <p className="text-gray-400 text-xs mt-1">Leave blank for a random link. Lowercase letters, numbers, and dashes only.</p>
            )}
            <p className="text-xs mt-1 text-gray-500 break-all">
              Preview: <span className="font-mono text-gray-700">{window.location.origin}/pay/{previewSlug}</span>
            </p>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Notify me by email (optional)</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" className={input} />
            <p className="text-gray-400 text-xs mt-1">We email you each time this link is paid.</p>
          </div>

          {error && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading || !!problem}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Payment Link'}
          </button>
        </form>
      )}
    </div>
  );
}
