'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { IntakeMessage } from '@tryout/shared';
import { api } from '@/lib/api';
import styles from './dashboard.module.css';

const RUN_ID_KEY = 'tryout_run_id';
const INTAKE_ID_KEY = 'tryout_intake_id';

export function IntakeChat({ onPlaced }: { onPlaced: () => void }) {
  const router = useRouter();
  const [intakeId, setIntakeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<IntakeMessage[]>([]);
  const [readyToPlace, setReadyToPlace] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

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
    } catch {
      setError('Message failed to send. Try again.');
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
      onPlaced();
      router.push('/run');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place you. Try again.');
      setPlacing(false);
    }
  }

  return (
    <section className={styles.intake} aria-label="Onboarding chat with Sam">
      <div className={styles.intakeThread}>
        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.intakeBubble} ${
              m.role === 'recruiter' ? styles.intakeFromSam : styles.intakeFromYou
            }`}
          >
            {m.role === 'recruiter' && <span className={styles.intakeWho}>Sam · Talent Lead</span>}
            <p>{m.content}</p>
          </div>
        ))}
        {busy && <p className={styles.intakeTyping}>Sam is typing…</p>}
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
