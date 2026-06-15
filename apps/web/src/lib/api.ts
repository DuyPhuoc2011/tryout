import type { AuthResponse, ScenarioCompanyContext, ScenarioTicket } from '@tryout/shared';

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

export interface StartRunResponse {
  id: string;
  repoUrl: string;
  status: string;
}

export interface ScenarioRunView {
  id: string;
  status: string;
  startedAt: string | null;
  scenario: {
    title: string;
    companyContext: ScenarioCompanyContext;
    ticket: ScenarioTicket;
  } | null;
  repo: { url: string; prNumber: number | null } | null;
  pmIntro: { content: string; createdAt: string } | null;
  latestSubmission: { prUrl: string; ciStatus: string | null; createdAt: string } | null;
  latestReview: {
    verdict: 'approve' | 'request_changes';
    comments: { summary: string; comments: string[] } | null;
    createdAt: string;
  } | null;
}

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),

  startRun: async (): Promise<StartRunResponse> => {
    const res = await fetch(`${API_URL}/scenario-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to start run (${res.status})`);
    return res.json() as Promise<StartRunResponse>;
  },

  getRun: async (id: string): Promise<ScenarioRunView> => {
    const res = await fetch(`${API_URL}/scenario-runs/${id}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
    return res.json() as Promise<ScenarioRunView>;
  },
};
