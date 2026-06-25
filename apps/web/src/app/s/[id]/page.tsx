'use client';

/*
 * Public, no-login scorecard. A candidate shares /s/<runId> with a recruiter.
 * Same dark-indigo brand world as the run workspace. Doubles as a growth hook:
 * the recruiter who lands here gets a clear "run your own, free" path.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type PublicScorecardView } from '@/lib/api';
import { ScorecardView } from '@/components/ScorecardView';
import styles from '@/app/run/run.module.css';

export default function SharedScorecardPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [card, setCard] = useState<PublicScorecardView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    if (!id) return;
    let active = true;
    api
      .getPublicScorecard(id)
      .then((res) => {
        if (!active) return;
        if (!res) return setState('missing');
        setCard(res);
        setState('ready');
      })
      .catch(() => active && setState('missing'));
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.wordmark}>
          Try<b>out</b>
        </Link>
        <Link href="/signup" className={styles.back}>
          Run your own →
        </Link>
      </header>

      <main className={styles.main}>
        {state === 'loading' && (
          <div className={styles.center}>
            <span className={styles.spinner} role="status" aria-label="Loading scorecard" />
          </div>
        )}

        {state === 'missing' && (
          <div className={styles.center}>
            <div className={styles.empty}>
              <h1 className={styles.emptyTitle}>Scorecard not found</h1>
              <p className={styles.emptyLede}>
                This link is wrong or the tryout has not been graded yet.
              </p>
              <Link href="/signup" className={styles.btnPrimary}>
                Run your own tryout →
              </Link>
            </div>
          </div>
        )}

        {state === 'ready' && card && (
          <>
            <div className={styles.runHeader}>
              <div>
                <p className={styles.company}>SHARED SCORECARD</p>
                <h1 className={styles.title}>{card.scenarioTitle}</h1>
              </div>
            </div>

            <ScorecardView scorecard={card} />

            <div className={styles.scorecard} style={{ textAlign: 'center' }}>
              <h2 className={styles.cardTitle}>Want a scorecard like this?</h2>
              <p className={styles.prose} style={{ marginBottom: '1.25rem' }}>
                Tryout drops you into a real repo with an AI engineering team, then grades how you
                build and how you communicate. Free to run.
              </p>
              <Link href="/signup" className={styles.btnPrimary}>
                Start a free tryout →
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
