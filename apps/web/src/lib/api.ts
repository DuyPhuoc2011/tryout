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

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('tryout_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Pull a human message out of a failed response (NestJS sends `{ message }`). */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  if (!text) return fallback;
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(', ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    // not JSON — fall through to the raw text
  }
  return text;
}

export interface ListingSummary {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  priceCents: number;
  currency: string;
}

export interface ListingDetail extends ListingSummary {
  story: string;
  contents: string;
}

export interface PurchaseView {
  id: string;
  status: 'pending' | 'paid' | 'invite_sent' | 'invite_failed' | 'refunded';
  createdAt: string;
  listingTitle: string;
  listingSlug: string;
  repoUrl: string | null;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface TutorThread {
  phase: string;
  messages: TutorMessage[];
}

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),

  catalog: async (): Promise<ListingSummary[]> => {
    const res = await fetch(`${API_URL}/catalog`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
    return res.json() as Promise<ListingSummary[]>;
  },

  checkout: async (listingId: string, githubUsername?: string): Promise<{ url: string }> => {
    const res = await fetch(`${API_URL}/purchases/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(githubUsername ? { listingId, githubUsername } : { listingId }),
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Checkout failed (${res.status})`));
    }
    return res.json() as Promise<{ url: string }>;
  },

  myPurchases: async (): Promise<PurchaseView[]> => {
    const res = await fetch(`${API_URL}/purchases/mine`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Failed to load purchases (${res.status})`);
    return res.json() as Promise<PurchaseView[]>;
  },

  retryInvite: async (purchaseId: string): Promise<{ status: string }> => {
    const res = await fetch(`${API_URL}/purchases/${purchaseId}/retry-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Retry failed (${res.status})`));
    }
    return res.json() as Promise<{ status: string }>;
  },

  getTutorThread: async (listingId: string): Promise<TutorThread> => {
    const res = await fetch(`${API_URL}/tutor/${listingId}/messages`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load tutor (${res.status})`);
    return res.json() as Promise<TutorThread>;
  },

  sendTutorMessage: async (
    listingId: string,
    content: string,
  ): Promise<{ reply: string; phase: string }> => {
    const res = await fetch(`${API_URL}/tutor/${listingId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to send (${res.status})`));
    }
    return res.json() as Promise<{ reply: string; phase: string }>;
  },
};
