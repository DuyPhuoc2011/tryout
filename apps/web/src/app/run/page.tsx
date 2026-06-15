'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, type ScenarioRunView } from '@/lib/api';
import { RunView } from '@/components/RunView';

const RUN_ID_KEY = 'tryout_run_id';

export default function RunPage() {
  const [run, setRun] = useState<ScenarioRunView | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(RUN_ID_KEY);
    if (stored) setRunId(stored);
  }, []);

  const refresh = useCallback(async (id: string) => {
    try {
      const data = await api.getRun(id);
      setRun(data);
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

  async function onStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await api.startRun();
      window.localStorage.setItem(RUN_ID_KEY, res.id);
      setRunId(res.id);
    } catch {
      setError('Could not start the scenario. Are you logged in?');
    } finally {
      setStarting(false);
    }
  }

  if (!runId) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 'var(--text-xl, 1.75rem)', margin: 0 }}>Ready to join the team?</h1>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>
          Start the scenario to get your repo, your ticket, and a message from your PM.
        </p>
        {error && <p role="alert" style={{ color: 'var(--color-danger, #b42318)', margin: 0 }}>{error}</p>}
        <button type="button" onClick={onStart} disabled={starting}>
          {starting ? 'Setting things up…' : 'Start the scenario'}
        </button>
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

  return <RunView run={run} />;
}
