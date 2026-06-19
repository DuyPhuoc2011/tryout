export type IntakeSpeaker = 'recruiter' | 'candidate';

export interface IntakeMessage {
  role: IntakeSpeaker;
  content: string;
}

export interface ProfileSnapshot {
  experienceLevel: string | null;
  languages: string[];
  strengths: string[];
  gaps: string[];
  goals: string | null;
  confidence: number;
}

export interface IntakeSessionView {
  id: string;
  transcript: IntakeMessage[];
  profile: ProfileSnapshot;
  readyToPlace: boolean;
}

export interface IntakeTurnResult {
  reply: string;
  transcript: IntakeMessage[];
  profile: ProfileSnapshot;
  readyToPlace: boolean;
}

export interface IntakePlacementResult {
  runId: string;
  scenarioId: string;
  role: string;
  rationale: string;
}
