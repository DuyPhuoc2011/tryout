'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AuthShell, FieldStack } from '@/components/AuthShell';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.signup(email, password);
      localStorage.setItem('tryout_token', res.token);
      localStorage.setItem('tryout_email', res.user.email);
      window.location.href = '/dashboard';
    } catch {
      setError('Unable to create an account with those details.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--space-1)' }}>Join Tryout</h1>
      <p style={{ color: 'var(--color-muted)', margin: '0 0 var(--space-4)' }}>
        Create an account to start your first ticket.
      </p>
      <form onSubmit={onSubmit} aria-label="Sign up">
        <FieldStack>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="password">Password (min 8 characters)</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              required
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" style={{ color: 'var(--color-danger)', margin: 0, fontSize: 'var(--text-sm)' }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </FieldStack>
      </form>
      <p style={{ marginTop: 'var(--space-4)', color: 'var(--color-muted)' }}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </AuthShell>
  );
}
