import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { ListingDetail } from '@/lib/api';
import { BuyButton } from './BuyButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export const revalidate = 3600;

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

async function getListing(slug: string): Promise<ListingDetail | null> {
  try {
    const res = await fetch(`${API_URL}/catalog/${slug}`);
    if (!res.ok) return null;
    return (await res.json()) as ListingDetail;
  } catch {
    return null;
  }
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
