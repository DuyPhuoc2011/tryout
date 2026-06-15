'use client';

import { useState } from 'react';
import { api, type AgentMessageView } from '@/lib/api';

interface ChatPanelProps {
  runId: string;
  agentRole: 'pm' | 'senior';
  title: string;
  messages: AgentMessageView[];
  onSent: () => void;
}

const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 12px)',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  minHeight: 320,
};

export function ChatPanel({ runId, agentRole, title, messages, onSent }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = messages.filter((m) => m.agentRole === agentRole);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    try {
      await api.sendMessage(runId, agentRole, content);
      setDraft('');
      onSent();
    } catch {
      setError('Could not send. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section style={panelStyle} aria-label={`Chat with ${title}`}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-md, 1.25rem)' }}>{title}</h2>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', overflowY: 'auto' }}>
        {thread.length === 0 ? (
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>No messages yet. Say hello.</p>
        ) : (
          thread.map((m) => (
            <div
              key={m.id}
              style={{
                alignSelf: m.direction === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background:
                  m.direction === 'user' ? 'var(--color-accent-soft, #eef2ff)' : 'var(--color-bg, #f6f6f6)',
                borderRadius: 10,
                padding: 'var(--space-2) var(--space-3)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          ))
        )}
      </div>
      {error && <p role="alert" style={{ color: 'var(--color-danger, #b42318)', margin: 0 }}>{error}</p>}
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <input
          aria-label={`Message ${title}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${title}…`}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
