import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import PaymentForm from '../components/PaymentForm';
import { api } from '../api';

export default function PayPage() {
  const { slug } = useParams();
  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setLink(null);

    api(`/api/links/${encodeURIComponent(slug)}`).then((result) => {
      if (cancelled) return;
      if (!result.success) setError(result.error || 'Payment link not found.');
      else setLink(result.data);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]" role="status" aria-label="Loading">
        <div className="w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto text-center py-12">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Link unavailable</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <Link to="/dashboard" className="text-green-600 hover:underline text-sm">Back to PayLink</Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <PaymentForm amount={link.amount} description={link.description} linkSlug={slug} />
    </div>
  );
}
