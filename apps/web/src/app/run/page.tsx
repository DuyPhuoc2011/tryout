'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, type ScenarioRunView, type AgentMessageView, type ScorecardView as Scorecard } from '@/lib/api';
import { RunView } from '@/components/RunView';
import { ChatPanel } from '@/components/ChatPanel';
import { ScorecardView } from '@/components/ScorecardView';
import styles from './run.module.css';

const RUN_ID_KEY = 'tryout_run_id';

function Topbar() {
  return (
    <header className={styles.topbar}>
      <Link href="/dashboard" className={styles.wordmark}>
        Try<b>out</b>
      </Link>
      <Link href="/dashboard" className={styles.back}>
        ← Workspace
      </Link>
    </header>
  );
}

export default function RunPage() {
  const [run, setRun] = useState<ScenarioRunView | null>(null);
  const [messages, setMessages] = useState<AgentMessageView[]>([]);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [grading, setGrading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(RUN_ID_KEY);
    if (stored) setRunId(stored);
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      const [data, msgs, card] = await Promise.all([
        api.getRun(id),
        api.getMessages(id),
        api.getScorecard(id),
      ]);
      setRun(data);
      setMessages(msgs);
      setScorecard(card);
    } catch {
      setError('Could not load your run.');
    }
  }, []);

  useEffect(() => {
    if (!runId) return;
    refresh(runId);
    const interval = setInterval(() => refresh(runId), 15_000);
    return () => clearInterval(interval);
  }, [runId, refresh]);

  if (!runId) {
    return (
      <div className={styles.page}>
        <Topbar />
        <div className={styles.center}>
          <div className={styles.empty}>
            <h1 className={styles.emptyTitle}>No tryout in progress</h1>
            <p className={styles.emptyLede}>
              Pick a project and claim your seat to get your repo, your ticket, and a message from
              your PM.
            </p>
            <Link href="/dashboard" className={styles.btnPrimary}>
              Browse projects →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className={styles.page}>
        <Topbar />
        <div className={styles.center}>
          {error ? (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          ) : (
            <span className={styles.spinner} role="status" aria-label="Loading your run" />
          )}
        </div>
      </div>
    );
  }

  async function onGrade() {
    if (!run) return;
    setGrading(true);
    setError(null);
    try {
      await api.requestGrade(run.id);
      await refresh(run.id);
    } catch {
      setError('Could not submit for grading. Open a PR first.');
    } finally {
      setGrading(false);
    }
  }

  return (
    <div className={styles.page}>
      <Topbar />
      <main className={styles.main}>
        <RunView run={run} />

        {scorecard ? (
          <ScorecardView scorecard={scorecard} />
        ) : run.status === 'grading' ? (
          <div className={styles.gradeBar}>
            <span className={styles.spinner} role="status" aria-label="Grading in progress" />
            <p className={styles.gradeNote}>Grading in progress… (refreshes automatically)</p>
          </div>
        ) : run.latestSubmission ? (
          <div className={styles.gradeBar}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={onGrade}
              disabled={grading}
            >
              {grading ? 'Submitting…' : 'Submit for grading'}
            </button>
            {error && (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            )}
          </div>
        ) : null}

        <div className={styles.chatGrid}>
          <ChatPanel
            runId={run.id}
            agentRole="pm"
            name="Mai"
            roleLabel="Product Manager"
            messages={messages}
            onSent={() => refresh(run.id)}
          />
          <ChatPanel
            runId={run.id}
            agentRole="senior"
            name="Alex"
            roleLabel="Senior Engineer"
            messages={messages}
            onSent={() => refresh(run.id)}
          />
        </div>
      </main>
    </div>
  );
}
