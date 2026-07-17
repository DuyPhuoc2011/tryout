'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, type TutorMessage } from '@/lib/api';
import styles from './tutor.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function TutorPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const [listingId, setListingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState('orient');
  const [messages, setMessages] = useState<TutorMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = window.localStorage.getItem('tryout_token');
    if (!token) {
      router.replace(`/login?next=/scenarios/${slug}/tutor`);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error('Scenario not found');
        const listing = (await res.json()) as { id: string; title: string };
        setListingId(listing.id);
        setTitle(listing.title);
        const thread = await api.getTutorThread(listing.id);
        setPhase(thread.phase);
        setMessages(thread.messages);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, [slug, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!listingId || !input.trim() || sending) return;
    const content = input.trim();
    setInput('');
    setError(null);
    setSending(true);
    const optimistic: TutorMessage = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api.sendTutorMessage(listingId, content);
      setPhase(res.phase);
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.reply,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(content);
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <main>
      <div className={styles.band}>
        <div className={styles.bandInner}>
          <nav className={styles.nav}>
            <Link href="/home" className={styles.logo}>
              Try<b>out</b>
            </Link>
            <Link href="/home" className={styles.back}>
              Back to scenarios
            </Link>
          </nav>
          <h1 className={styles.title}>{title || 'Tutor'}</h1>
          <span className={styles.phase}>Phase: {phase}</span>
        </div>
      </div>

      <div className={styles.body}>
        {messages.length === 0 && !error && (
          <p className={styles.greeting}>
            I&apos;ll walk you through this incident one phase at a time. Tell me where you
            are, or describe what you&apos;re seeing, and we&apos;ll start from there.
          </p>
        )}
        <div className={styles.thread}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`${styles.turn} ${m.role === 'user' ? styles.user : styles.assistant}`}
            >
              {m.content}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.form}>
          <textarea
            className={styles.input}
            value={input}
            placeholder="Describe what you see…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className={styles.send} onClick={() => void send()} disabled={sending}>
            {sending ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </main>
  );
}
