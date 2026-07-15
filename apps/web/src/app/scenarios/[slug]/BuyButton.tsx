'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface BuyButtonProps {
  listingId: string;
  slug: string;
  priceLabel: string;
}

export function BuyButton({ listingId, slug, priceLabel }: BuyButtonProps) {
  const router = useRouter();
  const [needsUsername, setNeedsUsername] = useState(false);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    const token = window.localStorage.getItem('tryout_token');
    if (!token) {
      router.push(`/login?next=/scenarios/${slug}`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { url } = await api.checkout(listingId, username.trim() || undefined);
      window.location.href = url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      if (message.includes('GITHUB_USERNAME_REQUIRED')) {
        // First purchase: we need to know which GitHub account to invite.
        setNeedsUsername(true);
      } else {
        setError(message);
      }
      setLoading(false);
    }
  }

  return (
    <div>
      {needsUsername && (
        <label>
          Your GitHub username (receives the repo invite):
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="octocat"
          />
        </label>
      )}
      <button onClick={buy} disabled={loading || (needsUsername && !username.trim())}>
        {loading ? 'Redirecting…' : `Buy — ${priceLabel}`}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
