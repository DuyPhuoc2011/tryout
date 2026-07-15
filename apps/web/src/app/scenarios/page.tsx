import Link from 'next/link';
import type { ListingSummary } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const revalidate = 3600;

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

async function getListings(): Promise<ListingSummary[]> {
  try {
    const res = await fetch(`${API_URL}/catalog`);
    if (!res.ok) return [];
    return (await res.json()) as ListingSummary[];
  } catch {
    // API unreachable (e.g. during a static build) — render an empty catalog;
    // ISR revalidation fills it in at runtime.
    return [];
  }
}

export default async function ScenariosPage() {
  const listings = await getListings();
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1>DevOps Scenarios</h1>
      <p>Real incidents. Real infrastructure. Learn Day-2 operations by walking the recovery.</p>
      {listings.length === 0 && <p>No scenarios published yet — check back soon.</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '1rem' }}>
        {listings.map((l) => (
          <li key={l.id}>
            <Link href={`/scenarios/${l.slug}`}>
              <h2>{l.title}</h2>
              <p>{l.tagline}</p>
              <strong>{formatPrice(l.priceCents, l.currency)}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
