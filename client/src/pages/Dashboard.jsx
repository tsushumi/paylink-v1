import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, copyText, formatKES } from '../api';

const FILTERS = [
  ['all', 'All'],
  ['completed', 'Completed'],
  ['pending', 'Pending'],
  ['failed', 'Failed'],
  ['cancelled', 'Cancelled'],
];

const STATUS_STYLES = {
  completed: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-200 text-gray-600',
};

export default function Dashboard() {
  const [links, setLinks] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedSlug, setCopiedSlug] = useState('');
  const [busySlug, setBusySlug] = useState('');
  const [qrFor, setQrFor] = useState(null); // { slug, qr }
  const [statusFilter, setStatusFilter] = useState('all');

  // Each load gets a ticket; if a newer load (or a local edit) happens while a request is
  // in flight, the stale response is dropped instead of overwriting fresher state.
  const loadTicket = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++loadTicket.current;
    const [l, p] = await Promise.all([api('/api/links'), api(`/api/payments?limit=100${statusFilter === 'all' ? '' : `&status=${statusFilter}`}`)]);
    if (ticket !== loadTicket.current) return;
    if (!l.success) setError(l.error);
    else {
      setError('');
      setLinks(l.data);
    }
    if (p.success) setPayments(p.data);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
    // keep the dashboard fresh while it is open (payments arrive via callbacks)
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const totalCollected = links.reduce((sum, l) => sum + l.totalCollected, 0);
  const totalPayments = links.reduce((sum, l) => sum + l.totalPayments, 0);

  async function handleCopy(slug) {
    if (await copyText(`${window.location.origin}/pay/${slug}`)) {
      setCopiedSlug(slug);
      setTimeout(() => setCopiedSlug(''), 1500);
    }
  }

  async function toggleActive(link) {
    if (link.active && !window.confirm(`Deactivate "${link.description}"? People will no longer be able to pay through it.`)) return;
    setBusySlug(link.slug);
    const result = await api(`/api/links/${link.slug}`, { method: 'PATCH', body: { active: !link.active } });
    setBusySlug('');
    if (!result.success) return setError(result.error);
    loadTicket.current += 1; // invalidate any refresh that started before this change
    setLinks((prev) => prev.map((l) => (l.slug === link.slug ? { ...l, active: result.data.active } : l)));
  }

  async function showQr(slug) {
    const result = await api(`/api/links/${slug}/qr`);
    if (result.success) setQrFor({ slug, qr: result.data.qr, url: result.data.url });
    else setError(result.error);
  }

  const th = 'px-4 py-3 text-sm font-medium text-gray-500';

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Link to="/create" className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors">Create Link</Link>
      </div>

      {error && <div role="alert" className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-gray-500 text-sm">Total Links</p>
          <p className="text-2xl font-bold text-gray-900">{links.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-gray-500 text-sm">Total Payments</p>
          <p className="text-2xl font-bold text-gray-900">{totalPayments}</p>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-gray-500 text-sm">Total Collected</p>
          <p className="text-2xl font-bold text-green-600">{formatKES(totalCollected)}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : links.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow">
          <p className="text-gray-500 mb-4">No payment links yet</p>
          <Link to="/create" className="text-green-600 font-medium hover:underline">Create your first link</Link>
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Payment links</h2>
          <div className="bg-white rounded-xl shadow overflow-x-auto mb-8">
            <table className="w-full min-w-[640px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className={`${th} text-left`}>Description</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Payments</th>
                  <th className={`${th} text-right`}>Collected</th>
                  <th className={`${th} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {links.map((link) => (
                  <tr key={link.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {link.description}
                        {!link.active && <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>}
                      </p>
                      <p className="text-xs text-gray-400">/pay/{link.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">{formatKES(link.amount)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{link.totalPayments}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">{formatKES(link.totalCollected)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-3 text-sm">
                      <button onClick={() => handleCopy(link.slug)} className="text-green-600 hover:underline">
                        {copiedSlug === link.slug ? 'Copied!' : 'Copy'}
                      </button>
                      <button onClick={() => showQr(link.slug)} className="text-green-600 hover:underline">QR</button>
                      <a href={`/api/links/${link.slug}/payments.csv`} className="text-green-600 hover:underline">CSV</a>
                      <button onClick={() => toggleActive(link)} disabled={busySlug === link.slug}
                        className={`${link.active ? 'text-red-600' : 'text-blue-600'} hover:underline disabled:opacity-50`}>
                        {link.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Transaction history</h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
              {FILTERS.map(([value, label]) => (
                <button key={value} onClick={() => setStatusFilter(value)} aria-pressed={statusFilter === value}
                  className={`px-3 py-1 rounded-full text-sm ${statusFilter === value ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 shadow-sm'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {payments.length === 0 ? (
            <p className="text-gray-500 text-sm">{statusFilter === 'all' ? 'No transactions yet.' : 'No transactions match this filter.'}</p>
          ) : (
            <div className="bg-white rounded-xl shadow overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={`${th} text-left`}>Link</th>
                    <th className={`${th} text-left`}>Phone</th>
                    <th className={`${th} text-right`}>Amount</th>
                    <th className={`${th} text-left`}>Receipt</th>
                    <th className={`${th} text-right`}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {p.linkDescription || '-'}
                        <p className="text-xs text-gray-400">{new Date(p.createdAt).toLocaleString('en-KE')}</p>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono">{p.phoneNumber}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatKES(p.amount)}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-600">{p.mpesaReceiptNumber || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[p.status] || STATUS_STYLES.cancelled}`}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {qrFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-10" onClick={() => setQrFor(null)} role="dialog" aria-modal="true" aria-label="QR code">
          <div className="bg-white rounded-xl p-6 text-center max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
            <img src={qrFor.qr} alt={`QR code for ${qrFor.url}`} className="mx-auto" width="240" height="240" />
            <p className="text-xs text-gray-500 break-all mt-2">{qrFor.url}</p>
            <div className="flex gap-3 mt-4">
              <a href={qrFor.qr} download={`paylink-${qrFor.slug}.png`} className="flex-1 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">Download</a>
              <button onClick={() => setQrFor(null)} className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg text-sm font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
