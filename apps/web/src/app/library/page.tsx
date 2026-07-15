'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type PurchaseView } from '@/lib/api';

const STATUS_LABEL: Record<PurchaseView['status'], string> = {
  pending: 'Payment pending',
  paid: 'Processing invite…',
  invite_sent: 'Invite sent',
  invite_failed: 'Invite failed',
  refunded: 'Refunded',
};

// paid included: recovers a purchase stuck between payment and the GitHub invite.
const RETRYABLE: ReadonlyArray<PurchaseView['status']> = ['paid', 'invite_failed', 'invite_sent'];

export default function LibraryPage() {
  const router = useRouter();
  const [purchases, setPurchases] = useState<PurchaseView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem('tryout_token');
    if (!token) {
      router.push('/login?next=/library');
      return;
    }
    api
      .myPurchases()
      .then(setPurchases)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      );
  }, [router]);

  async function retry(purchaseId: string) {
    setRetrying(purchaseId);
    setError(null);
    try {
      await api.retryInvite(purchaseId);
      setPurchases(await api.myPurchases());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetrying(null);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1>Your scenarios</h1>
      {error && <p role="alert">{error}</p>}
      {purchases === null && !error && <p>Loading…</p>}
      {purchases?.length === 0 && (
        <p>
          Nothing here yet. <Link href="/scenarios">Browse scenarios</Link>
        </p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
        {purchases?.map((p) => (
          <li key={p.id}>
            <h2>{p.listingTitle}</h2>
            <p>{STATUS_LABEL[p.status]}</p>
            {p.repoUrl && (
              <a href={p.repoUrl} target="_blank" rel="noreferrer">
                Open repository
              </a>
            )}
            {RETRYABLE.includes(p.status) && (
              <button onClick={() => retry(p.id)} disabled={retrying === p.id}>
                {retrying === p.id ? 'Re-sending…' : 'Re-send invite'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
