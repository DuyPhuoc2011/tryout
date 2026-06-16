'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, type ScenarioRunView, type AgentMessageView, type ScorecardView as Scorecard } from '@/lib/api';
import { RunView } from '@/components/RunView';
import { ChatPanel } from '@/components/ChatPanel';
import { ScorecardView } from '@/components/ScorecardView';

const RUN_ID_KEY = 'tryout_run_id';

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
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--text-xl, 1.75rem)', margin: 0 }}>No tryout in progress</h1>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>
          Pick a project and claim your seat to get your repo, your ticket, and a message from your PM.
        </p>
        <Link href="/dashboard">Browse projects →</Link>
      </main>
    );
  }

  if (!run) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-5)' }}>
        {error ? (
          <p role="alert" style={{ color: 'var(--color-danger, #b42318)' }}>{error}</p>
        ) : (
          <p style={{ color: 'var(--color-muted)' }}>Loading your run…</p>
        )}
      </main>
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
    <div style={{ maxWidth: 980, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-4)' }}>
      <RunView run={run} />

      {scorecard ? (
        <ScorecardView scorecard={scorecard} />
      ) : run.status === 'grading' ? (
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>Grading in progress… (refreshes automatically)</p>
      ) : run.latestSubmission ? (
        <button type="button" onClick={onGrade} disabled={grading}>
          {grading ? 'Submitting…' : 'Submit for grading'}
        </button>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-4)' }}>
        <ChatPanel
          runId={run.id}
          agentRole="pm"
          title="Mai (PM)"
          messages={messages}
          onSent={() => refresh(run.id)}
        />
        <ChatPanel
          runId={run.id}
          agentRole="senior"
          title="Alex (Senior)"
          messages={messages}
          onSent={() => refresh(run.id)}
        />
      </div>
    </div>
  );
}
