import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { ListingDetail } from '@/lib/api';
import { BuyButton } from './BuyButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Rendered per request: the Docker build has no API, so any prerender would
// bake an empty catalog into the page for the whole revalidate window.
export const dynamic = 'force-dynamic';

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

async function getListing(slug: string): Promise<ListingDetail | null> {
  const res = await fetch(`${API_URL}/catalog/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Listing unavailable (${res.status})`);
  return (await res.json()) as ListingDetail;
}

export default async function ScenarioDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const listing = await getListing(params.slug);
  if (!listing) notFound();

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1>{listing.title}</h1>
      <p>{listing.tagline}</p>

      <section>
        <ReactMarkdown>{listing.story}</ReactMarkdown>
      </section>

      <section>
        <h2>What you get</h2>
        <ReactMarkdown>{listing.contents}</ReactMarkdown>
      </section>

      <section>
        <BuyButton
          listingId={listing.id}
          slug={listing.slug}
          priceLabel={formatPrice(listing.priceCents, listing.currency)}
        />
      </section>
    </main>
  );
}
