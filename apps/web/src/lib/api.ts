import type { AuthResponse } from '@tryout/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),
};
