'use client';

import { useState } from 'react';
import { api, type AgentMessageView } from '@/lib/api';
import styles from '@/app/run/run.module.css';

interface ChatPanelProps {
  runId: string;
  agentRole: 'pm' | 'senior';
  name: string;
  roleLabel: string;
  messages: AgentMessageView[];
  onSent: () => void;
}

export function ChatPanel({ runId, agentRole, name, roleLabel, messages, onSent }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const thread = messages.filter((m) => m.agentRole === agentRole);
  const initial = name.charAt(0).toUpperCase();

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
    <section className={styles.chatPanel} aria-label={`Chat with ${name}`}>
      <div className={styles.chatHead}>
        <span
          className={`${styles.chatAvatar} ${
            agentRole === 'pm' ? styles.avatarPm : styles.avatarSenior
          }`}
        >
          {initial}
        </span>
        <div>
          <div className={styles.chatName}>{name}</div>
          <div className={styles.chatRole}>{roleLabel}</div>
        </div>
      </div>

      <div className={styles.thread}>
        {thread.length === 0 ? (
          <p className={styles.threadEmpty}>No messages yet. Say hello.</p>
        ) : (
          thread.map((m) => (
            <div
              key={m.id}
              className={`${styles.bubble} ${
                m.direction === 'user' ? styles.bubbleUser : styles.bubbleAgent
              }`}
            >
              {m.content}
            </div>
          ))
        )}
      </div>

      {error && (
        <p role="alert" className={styles.alert} style={{ margin: '0 1rem' }}>
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className={styles.chatForm}>
        <input
          className={styles.chatInput}
          aria-label={`Message ${name}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${name}…`}
        />
        <button type="submit" className={styles.sendBtn} disabled={sending}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
