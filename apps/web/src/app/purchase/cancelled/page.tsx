import Link from 'next/link';

export default function PurchaseCancelledPage() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: '4rem 1.5rem' }}>
      <h1>Checkout cancelled</h1>
      <p>No charge was made. The scenario will be here when you are ready.</p>
      <Link href="/scenarios">Back to scenarios</Link>
    </main>
  );
}
