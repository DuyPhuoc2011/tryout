export const QUEUE_NAMES = {
  POLL_PR: 'poll-pr',
  POLL_CI: 'poll-ci',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface PollPrJobData {
  scenarioRunId: string;
  repoOwner: string;
  repoName: string;
  attemptCount: number;
}

export interface PollCiJobData {
  submissionId: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  headSha: string;
  attemptCount: number;
}
