export const SCENARIO_RUN_STATUSES = [
  'onboarding',
  'in_progress',
  'in_review',
  'grading',
  'complete',
] as const;
export type ScenarioRunStatus = (typeof SCENARIO_RUN_STATUSES)[number];

export const AGENT_ROLES = ['pm', 'senior'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const MESSAGE_DIRECTIONS = ['user', 'agent'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const REVIEW_VERDICTS = ['approve', 'request_changes'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
