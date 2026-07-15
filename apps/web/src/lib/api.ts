import type {
  AuthResponse,
  ScenarioCompanyContext,
  ScenarioTicket,
  TeamSeatView,
  IntakeSessionView,
  IntakeTurnResult,
  IntakePlacementResult,
} from '@tryout/shared';

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

export interface StartRunResponse {
  id: string;
  repoUrl: string;
  status: string;
}

export type TeamSeatViewWithYou = TeamSeatView & { isYou: boolean };

export interface ScenarioRunView {
  id: string;
  status: string;
  startedAt: string | null;
  chosenRole: string | null;
  scenario: {
    title: string;
    companyContext: ScenarioCompanyContext;
    ticket: ScenarioTicket;
  } | null;
  team: TeamSeatViewWithYou[];
  repo: { url: string; prNumber: number | null } | null;
  pmIntro: { content: string; createdAt: string } | null;
  latestSubmission: { prUrl: string; ciStatus: string | null; createdAt: string } | null;
  latestReview: {
    verdict: 'approve' | 'request_changes';
    comments: { summary: string; comments: string[] } | null;
    createdAt: string;
  } | null;
}

export interface AgentMessageView {
  id: string;
  agentRole: 'pm' | 'senior';
  direction: 'user' | 'agent';
  content: string;
  createdAt: string;
}

export interface ScorecardView {
  technicalScore: number;
  technicalFeedback: string;
  professionalScore: number;
  professionalFeedback: string;
  overallFeedback: string;
  createdAt: string;
}

export interface PublicScorecardView extends ScorecardView {
  scenarioTitle: string;
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

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),

  startIntake: async (): Promise<IntakeSessionView> => {
    const res = await fetch(`${API_URL}/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to start intake (${res.status})`);
    return res.json() as Promise<IntakeSessionView>;
  },

  getIntake: async (id: string): Promise<IntakeSessionView> => {
    const res = await fetch(`${API_URL}/intake/${id}`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Failed to load intake (${res.status})`);
    return res.json() as Promise<IntakeSessionView>;
  },

  sendIntakeMessage: async (id: string, content: string): Promise<IntakeTurnResult> => {
    const res = await fetch(`${API_URL}/intake/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Failed to send message (${res.status})`);
    return res.json() as Promise<IntakeTurnResult>;
  },

  uploadCv: async (id: string, file: File): Promise<IntakeTurnResult> => {
    const form = new FormData();
    form.append('file', file);
    // No Content-Type header: the browser sets the multipart boundary.
    const res = await fetch(`${API_URL}/intake/${id}/cv`, {
      method: 'POST',
      headers: { ...authHeaders() },
      body: form,
    });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `Failed to upload CV (${res.status})`);
    }
    return res.json() as Promise<IntakeTurnResult>;
  },

  placeIntake: async (id: string): Promise<IntakePlacementResult> => {
    const res = await fetch(`${API_URL}/intake/${id}/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to place (${res.status})`));
    }
    return res.json() as Promise<IntakePlacementResult>;
  },

  startRun: async (scenarioId: string, role: string): Promise<StartRunResponse> => {
    const res = await fetch(`${API_URL}/scenario-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ scenarioId, role }),
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res, `Failed to start run (${res.status})`));
    }
    return res.json() as Promise<StartRunResponse>;
  },

  getRun: async (id: string): Promise<ScenarioRunView> => {
    const res = await fetch(`${API_URL}/scenario-runs/${id}`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load run (${res.status})`);
    return res.json() as Promise<ScenarioRunView>;
  },

  getMessages: async (runId: string): Promise<AgentMessageView[]> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/messages`, {
      headers: { ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to load messages (${res.status})`);
    return res.json() as Promise<AgentMessageView[]>;
  },

  sendMessage: async (
    runId: string,
    agentRole: 'pm' | 'senior',
    content: string,
  ): Promise<AgentMessageView> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ agentRole, content }),
    });
    if (!res.ok) throw new Error(`Failed to send message (${res.status})`);
    return res.json() as Promise<AgentMessageView>;
  },

  requestGrade: async (runId: string): Promise<{ status: string }> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) throw new Error(`Failed to request grading (${res.status})`);
    return res.json() as Promise<{ status: string }>;
  },

  getScorecard: async (runId: string): Promise<ScorecardView | null> => {
    const res = await fetch(`${API_URL}/scenario-runs/${runId}/scorecard`, {
      headers: { ...authHeaders() },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load scorecard (${res.status})`);
    return res.json() as Promise<ScorecardView>;
  },

  // Public, no auth — used by the shareable scorecard page.
  getPublicScorecard: async (runId: string): Promise<PublicScorecardView | null> => {
    const res = await fetch(`${API_URL}/share/${runId}/scorecard`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to load scorecard (${res.status})`);
    return res.json() as Promise<PublicScorecardView>;
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
};
