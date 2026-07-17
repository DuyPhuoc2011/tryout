'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type ListingSummary, type PurchaseView } from '@/lib/api';
import styles from './home.module.css';

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

type Ownership = 'ready' | 'processing';

/** Slug → ownership, derived from the buyer's purchases. Refunded is not owned. */
function ownershipBySlug(purchases: PurchaseView[]): Map<string, Ownership> {
  const map = new Map<string, Ownership>();
  for (const p of purchases) {
    if (p.status === 'refunded' || p.status === 'pending') continue;
    // invite_sent = repo access granted; paid / invite_failed = mid-fulfilment.
    map.set(p.listingSlug, p.status === 'invite_sent' ? 'ready' : 'processing');
  }
  return map;
}

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [owned, setOwned] = useState<Map<string, Ownership>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = window.localStorage.getItem('tryout_token');
    if (!token) {
      router.replace('/login?next=/home');
      return;
    }
    setEmail(window.localStorage.getItem('tryout_email'));
    Promise.all([api.catalog(), api.myPurchases()])
      .then(([catalog, purchases]) => {
        setListings(catalog);
        setOwned(ownershipBySlug(purchases));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load scenarios'),
      );
  }, [router]);

  function logout() {
    window.localStorage.removeItem('tryout_token');
    window.localStorage.removeItem('tryout_email');
    router.replace('/login');
  }

  const name = email ? email.split('@')[0] : 'there';

  return (
    <main>
      <div className={styles.band}>
        <div className={styles.bandInner}>
          <nav className={styles.nav}>
            <Link href="/home" className={styles.logo}>
              Try<b>out</b>
            </Link>
            <div className={styles.navLinks}>
              <Link href="/library" className={styles.navLink}>
                Library
              </Link>
              <button type="button" className={styles.navLink} onClick={logout}>
                Log out
              </button>
            </div>
          </nav>

          <header className={styles.greeting}>
            <p className={styles.eyebrow}>Welcome back, {name}</p>
            <h1 className={styles.greetingTitle}>Pick an incident to work.</h1>
            <p className={styles.greetingSub}>
              Each scenario is a real production fault. Buy it, get the repo, then detect and
              recover it blind.
            </p>
          </header>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Scenarios</h2>
          <Link href="/library" className={styles.sectionLink}>
            Your library
          </Link>
        </div>

        {error && <p role="alert" className={styles.error}>{error}</p>}

        {listings === null && !error && (
          <ul className={styles.grid} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className={styles.skeleton}>
                <div className={styles.skeletonBar} />
                <div className={styles.skeletonBar} />
                <div className={styles.skeletonBar} />
              </li>
            ))}
          </ul>
        )}

        {listings?.length === 0 && (
          <div className={styles.emptyCard}>
            No scenarios published yet. Check back soon.
          </div>
        )}

        {listings && listings.length > 0 && (
          <ul className={styles.grid}>
            {listings.map((l) => {
              const own = owned.get(l.slug);
              const href = own ? '/library' : `/scenarios/${l.slug}`;
              return (
                <li key={l.id}>
                  <Link href={href} className={styles.cardLink}>
                    <div className={styles.card}>
                      <div className={styles.cardTopRow}>
                        <h3 className={styles.cardTitle}>{l.title}</h3>
                        {own === 'ready' && <span className={styles.ownedBadge}>Owned</span>}
                        {own === 'processing' && (
                          <span className={`${styles.ownedBadge} ${styles.processingBadge}`}>
                            Processing
                          </span>
                        )}
                      </div>
                      <p className={styles.cardTagline}>{l.tagline}</p>
                      <div className={styles.cardFoot}>
                        {own ? (
                          <span className={styles.action}>
                            {own === 'ready' ? 'Open in library →' : 'View status →'}
                          </span>
                        ) : (
                          <>
                            <span className={styles.price}>
                              {formatPrice(l.priceCents, l.currency)}
                            </span>
                            <span className={styles.action}>View →</span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
