import { useState, useEffect, useRef, useCallback } from 'react';
import { api, formatKES } from '../api';
import { formatPhoneHint, looksValid } from '../utils/phone';

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 40; // 40 x 3s = 2 minutes

export default function PaymentForm({ amount, description, linkSlug }) {
  const [phone, setPhone] = useState('');
  // idle | sending | waiting | completed | failed | cancelled | timeout
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [payment, setPayment] = useState(null);
  const pollTimer = useRef(null);
  const pollCount = useRef(0);
  const mounted = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  const poll = useCallback(
    async (paymentId) => {
      if (!mounted.current) return;
      pollCount.current += 1;
      const result = await api(`/api/payments/${paymentId}/poll`);
      if (!mounted.current) return;

      if (result.success) {
        const p = result.data;
        if (p.status !== 'pending') {
          setPayment(p);
          setStatus(p.status);
          return;
        }
      }
      // network blips and "still pending" both just try again until we run out of polls
      if (pollCount.current >= MAX_POLLS) {
        setStatus('timeout');
        return;
      }
      pollTimer.current = setTimeout(() => poll(paymentId), POLL_INTERVAL_MS);
    },
    []
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!looksValid(phone)) {
      setError('Enter a valid Safaricom number, e.g. 0712345678.');
      return;
    }

    setStatus('sending');
    const result = await api('/api/mpesa/stkpush', {
      method: 'POST',
      body: { phoneNumber: phone, linkSlug },
    });

    if (!mounted.current) return;
    if (!result.success) {
      setStatus('idle');
      setError(result.error);
      return;
    }

    pollCount.current = 0;
    setStatus('waiting');
    pollTimer.current = setTimeout(() => poll(result.data.paymentId), POLL_INTERVAL_MS);
  }

  function tryAgain() {
    stopPolling();
    setStatus('idle');
    setError('');
    setPayment(null);
  }

  const header = (
    <div className="text-center mb-6">
      <p className="text-gray-500 text-sm">{description}</p>
      <p className="text-4xl font-bold text-gray-900 mt-2">{formatKES(amount)}</p>
    </div>
  );

  if (status === 'completed') {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 text-center" role="status">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-9 h-9 text-green-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">Payment successful</h2>
        <p className="text-gray-500 text-sm mt-1">{description}</p>
        <dl className="mt-5 text-left bg-gray-50 rounded-lg p-4 text-sm space-y-2">
          <div className="flex justify-between"><dt className="text-gray-500">Amount</dt><dd className="font-semibold">{formatKES(payment?.amount ?? amount)}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">M-Pesa receipt</dt><dd className="font-mono font-semibold">{payment?.mpesaReceiptNumber || '-'}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Date</dt><dd>{new Date().toLocaleString('en-KE')}</dd></div>
        </dl>
        <p className="text-xs text-gray-400 mt-4">You will also get an M-Pesa confirmation SMS.</p>
      </div>
    );
  }

  if (status === 'failed' || status === 'cancelled' || status === 'timeout') {
    const copy = {
      cancelled: ['Payment cancelled', 'You cancelled the request on your phone. No money was taken.'],
      failed: ['Payment failed', payment?.resultDesc || 'The payment could not be completed. No money was taken.'],
      timeout: ['Still waiting for confirmation', 'We did not hear back from M-Pesa. If you entered your PIN, check your M-Pesa SMS before trying again so you do not pay twice.'],
    }[status];
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 text-center" role="alert">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-9 h-9 text-red-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900">{copy[0]}</h2>
        <p className="text-gray-600 text-sm mt-2">{copy[1]}</p>
        <button onClick={tryAgain} className="mt-6 w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors">
          Try again
        </button>
      </div>
    );
  }

  if (status === 'waiting') {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 text-center" role="status" aria-live="polite">
        {header}
        <div className="w-10 h-10 mx-auto mb-4 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
        <h2 className="font-semibold text-gray-900">Check your phone</h2>
        <p className="text-gray-600 text-sm mt-1">
          Enter your M-Pesa PIN on the prompt sent to <span className="font-medium">{phone}</span> to approve the payment.
        </p>
        <button onClick={tryAgain} className="mt-5 text-sm text-gray-500 hover:underline">Cancel and start over</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-lg p-6" noValidate>
      {header}
      <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Amount (KES)</label>
      <input
        id="amount"
        type="text"
        value={Number(amount).toLocaleString('en-KE')}
        readOnly
        aria-readonly="true"
        className="w-full px-4 py-3 mb-4 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 cursor-not-allowed outline-none"
      />

      <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">M-Pesa phone number</label>
      <input
        id="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(formatPhoneHint(e.target.value))}
        placeholder="0712345678"
        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none"
        required
      />

      {error && (
        <div role="alert" className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <button type="submit" disabled={status === 'sending'}
        className="mt-4 w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50">
        {status === 'sending' ? 'Sending request...' : 'Pay Now'}
      </button>
      <p className="text-xs text-gray-400 text-center mt-3">Secured by M-Pesa. You will get a prompt on your phone.</p>
    </form>
  );
}
