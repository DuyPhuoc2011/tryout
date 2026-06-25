'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IntakeMessage, IntakePlacementResult } from '@tryout/shared';
import { api } from '@/lib/api';
import styles from './dashboard.module.css';

const RUN_ID_KEY = 'tryout_run_id';
const INTAKE_ID_KEY = 'tryout_intake_id';

/** "backend_engineer" -> "Backend Engineer" for display. */
function prettyRole(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function IntakeChat({ onPlaced }: { onPlaced: () => void }) {
  const router = useRouter();
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IntakeMessage[]>([]);
  const [readyToPlace, setReadyToPlace] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placement, setPlacement] = useState<IntakePlacementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Word count revealed for the LAST (Sam) message; null = show in full.
  const [revealWords, setRevealWords] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Typewriter: reveal the latest Sam reply word-by-word (instant under reduced motion).
  useEffect(() => {
    if (revealWords === null) return;
    const last = messages[messages.length - 1];
    const total = last ? last.content.split(/\s+/).length : 0;
    revealTimer.current = setInterval(() => {
      setRevealWords((w) => {
        if (w === null || w >= total) {
          if (revealTimer.current) clearInterval(revealTimer.current);
          return null;
        }
        return w + 1;
      });
    }, 35);
    return () => {
      if (revealTimer.current) clearInterval(revealTimer.current);
    };
  }, [revealWords !== null, messages]);

  useEffect(() => {
    let active = true;
    const stored = window.localStorage.getItem(INTAKE_ID_KEY);
    const load = stored ? api.getIntake(stored) : api.startIntake();
    load
      .then((session) => {
        if (!active) return;
        window.localStorage.setItem(INTAKE_ID_KEY, session.id);
        setIntakeId(session.id);
        setMessages(session.transcript);
        setReadyToPlace(session.readyToPlace);
      })
      .catch(() => active && setError('Could not start onboarding. Please refresh.'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const content = draft.trim();
    if (!content || !intakeId || busy) return;
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'candidate', content }]);
    setDraft('');
    try {
      const result = await api.sendIntakeMessage(intakeId, content);
      setMessages(result.transcript);
      setReadyToPlace(result.readyToPlace);
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setRevealWords(reduce ? null : 1);
    } catch {
      setError('Message failed to send. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onCvSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file || !intakeId || busy) return;
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'candidate', content: `Uploaded CV: ${file.name}` }]);
    try {
      const result = await api.uploadCv(intakeId, file);
      setMessages(result.transcript);
      setReadyToPlace(result.readyToPlace);
      const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setRevealWords(reduce ? null : 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that CV. Try another file.');
    } finally {
      setBusy(false);
    }
  }

  async function place() {
    if (!intakeId || placing) return;
    setPlacing(true);
    setError(null);
    try {
      const result = await api.placeIntake(intakeId);
      window.localStorage.setItem(RUN_ID_KEY, result.runId);
      window.localStorage.removeItem(INTAKE_ID_KEY);
      // Reveal the match instead of teleporting — the button promises to SHOW
      // where they fit, so show it before handing off to the run.
      setPlacement(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place you. Try again.');
      setPlacing(false);
    }
  }

  function enterRun() {
    onPlaced();
    router.push('/run');
  }

  // Placement reveal — replaces the chat once Sam has matched the candidate.
  if (placement) {
    return (
      <section className={styles.placement} aria-label="Where you fit">
        <span className={styles.placementEyebrow}>Sam found your fit</span>
        <h2 className={styles.placementRole}>{prettyRole(placement.role)}</h2>
        <div className={styles.placementCard}>
          <span className={styles.intakeAvatar} aria-hidden>S</span>
          <div>
            <span className={styles.intakeWho}>Sam · Talent Lead</span>
            <p className={styles.placementRationale}>{placement.rationale}</p>
          </div>
        </div>
        <button type="button" className={styles.btnPrimary} onClick={enterRun}>
          Start the tryout →
        </button>
      </section>
    );
  }

  return (
    <section className={styles.intake} aria-label="Onboarding chat with Sam">
      <div className={styles.intakeThread}>
        {messages.map((m, i) => {
          const fromSam = m.role === 'recruiter';
          const isLast = i === messages.length - 1;
          const content =
            isLast && fromSam && revealWords !== null
              ? m.content.split(/\s+/).slice(0, revealWords).join(' ')
              : m.content;
          return (
            <div
              key={i}
              className={`${styles.intakeRow} ${fromSam ? styles.intakeRowSam : styles.intakeRowYou}`}
            >
              {fromSam && <span className={styles.intakeAvatar} aria-hidden>S</span>}
              <div
                className={`${styles.intakeBubble} ${fromSam ? styles.intakeFromSam : styles.intakeFromYou}`}
              >
                {fromSam && <span className={styles.intakeWho}>Sam · Talent Lead</span>}
                <p>{content}</p>
              </div>
            </div>
          );
        })}
        {busy && (
          <div className={`${styles.intakeRow} ${styles.intakeRowSam}`}>
            <span className={styles.intakeAvatar} aria-hidden>S</span>
            <div className={styles.intakeTyping} role="status" aria-label="Sam is typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className={styles.alert}>{error}</p>}

      {readyToPlace && (
        <div className={styles.intakeReady}>
          <p>Sam has a good read on you.</p>
          <button type="button" className={styles.btnPrimary} onClick={place} disabled={placing}>
            {placing ? 'Finding your fit…' : 'Show me where I fit →'}
          </button>
        </div>
      )}

      <form
        className={styles.intakeComposer}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          hidden
          onChange={onCvSelected}
        />
        <button
          type="button"
          className={styles.cvButton}
          onClick={() => fileRef.current?.click()}
          disabled={busy || !intakeId}
          aria-label="Upload your CV or resume (PDF)"
          title="Upload your CV or resume (PDF)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 15V4" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 20h14" />
          </svg>
          <span className={styles.cvLabel}>CV</span>
        </button>
        <input
          className={styles.intakeInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell Sam about your experience…"
          disabled={busy || !intakeId}
          aria-label="Your message to Sam"
        />
        <button type="submit" className={styles.btnPrimary} disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
