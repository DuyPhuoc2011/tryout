import type {
  AuthResponse,
  ScenarioCompanyContext,
  ScenarioTicket,
  ScenarioCatalogItem,
  ScenarioDetailView,
  TeamSeatView,
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

export const api = {
  signup: (email: string, password: string) =>
    post<AuthResponse>('/auth/signup', { email, password }),
  login: (email: string, password: string) =>
    post<AuthResponse>('/auth/login', { email, password }),

  getScenarios: async (): Promise<ScenarioCatalogItem[]> => {
    const res = await fetch(`${API_URL}/scenarios`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Failed to load scenarios (${res.status})`);
    return res.json() as Promise<ScenarioCatalogItem[]>;
  },

  getScenario: async (id: string): Promise<ScenarioDetailView> => {
    const res = await fetch(`${API_URL}/scenarios/${id}`, { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error(`Failed to load scenario (${res.status})`);
    return res.json() as Promise<ScenarioDetailView>;
  },

  startRun: async (scenarioId: string, role: string): Promise<StartRunResponse> => {
    const res = await fetch(`${API_URL}/scenario-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ scenarioId, role }),
    });
    if (!res.ok) {
      const message = await res.text();
      throw new Error(message || `Failed to start run (${res.status})`);
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
};
