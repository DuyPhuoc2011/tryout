import Link from 'next/link';

export default function PurchaseSuccessPage() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1>Payment received 🎉</h1>
      <p>
        Check your GitHub notifications — you have a repository invite waiting. Invites expire
        after 7 days; if yours lapses, you can re-send it from your library.
      </p>
      <Link href="/library">Go to your library</Link>
    </main>
  );
}
