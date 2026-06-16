'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, type ScenarioRunView } from '@/lib/api';
import styles from './dashboard.module.css';
import { CatalogFlow } from './CatalogFlow';
import { ResumeCard } from './ResumeCard';

const RUN_ID_KEY = 'tryout_run_id';
const TOKEN_KEY = 'tryout_token';
const EMAIL_KEY = 'tryout_email';

/** Best-effort email for the greeting: stored value, else decoded from the JWT. */
function resolveEmail(): string | null {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(EMAIL_KEY);
  if (stored) return stored;
  const token = window.localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

type Phase = 'loading' | 'empty' | 'active';

export default function DashboardPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('loading');
  const [run, setRun] = useState<ScenarioRunView | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const runId = window.localStorage.getItem(RUN_ID_KEY);
    if (!runId) {
      setRun(null);
      setPhase('empty');
      return;
    }
    try {
      const loaded = await api.getRun(runId);
      setRun(loaded);
      setPhase('active');
    } catch {
      // Stale or unauthorized run id — fall back to the catalog flow.
      window.localStorage.removeItem(RUN_ID_KEY);
      setRun(null);
      setPhase('empty');
    }
  }, []);

  useEffect(() => {
    if (!window.localStorage.getItem(TOKEN_KEY)) {
      router.replace('/login');
      return;
    }
    setEmail(resolveEmail());
    load();
  }, [router, load]);

  // Close the user menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function onLogout() {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(EMAIL_KEY);
    window.localStorage.removeItem(RUN_ID_KEY);
    router.replace('/login');
  }

  const initial = (email?.[0] ?? 'Y').toUpperCase();

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <Link href="/dashboard" className={styles.wordmark}>
          Try<b>out</b>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <Link href="/dashboard" className={styles.navLink} aria-current="page">
            Workspace
          </Link>
          {phase === 'active' && (
            <Link href="/run" className={styles.navLink}>
              Your tryout
            </Link>
          )}
          <Link href="/#how-it-works" className={styles.navLink}>
            How it works
          </Link>
        </nav>

        <div className={styles.userZone} ref={menuRef}>
          <button
            type="button"
            className={styles.userChip}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className={styles.userAvatar}>{initial}</span>
            <span className={styles.userEmail}>{email ?? 'Signed in'}</span>
            <span className={styles.userCaret} aria-hidden>
              ▾
            </span>
          </button>
          {menuOpen && (
            <div className={styles.userMenu} role="menu">
              <span className={styles.userMenuEmail}>{email ?? 'Signed in'}</span>
              <a
                href="mailto:support@tryout.dev"
                className={styles.userMenuItem}
                role="menuitem"
              >
                Support
              </a>
              <button
                type="button"
                className={`${styles.userMenuItem} ${styles.userMenuDanger}`}
                role="menuitem"
                onClick={onLogout}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      {phase === 'loading' && (
        <div className={styles.center}>
          <span className={styles.spinner} role="status" aria-label="Loading your dashboard" />
        </div>
      )}

      {phase !== 'loading' && (
        <main className={styles.main}>
          <div className={styles.greeting}>
            <p className={styles.greetEyebrow}>Your workspace</p>
            <h1 className={styles.greetTitle}>
              {phase === 'active' ? (
                <>Welcome back{email ? <>, <em>{email.split('@')[0]}</em></> : ''}.</>
              ) : (
                <>Pick a project to <em>try out</em>.</>
              )}
            </h1>
            <p className={styles.greetSub}>
              {phase === 'active'
                ? 'Your tryout is in progress — pick up where you left off.'
                : 'Choose a project, claim your seat on the team, and ship a real ticket alongside AI teammates.'}
            </p>
          </div>

          {phase === 'active' && run ? (
            <ResumeCard run={run} />
          ) : (
            <CatalogFlow onStarted={() => setPhase('active')} />
          )}
        </main>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <span className={styles.footerWordmark}>
              Try<b>out</b>
            </span>
            <span className={styles.footerCopy}>© {new Date().getFullYear()} Tryout</span>
          </div>
          <nav className={styles.footerNav} aria-label="Footer">
            <Link href="/#how-it-works" className={styles.footerLink}>
              How it works
            </Link>
            <a href="mailto:support@tryout.dev" className={styles.footerLink}>
              Support
            </a>
            <Link href="/" className={styles.footerLink}>
              Privacy
            </Link>
            <span className={styles.footerStatus}>
              <span className={styles.footerStatusDot} />
              All systems operational
            </span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
