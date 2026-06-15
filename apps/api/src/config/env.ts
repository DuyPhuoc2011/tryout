function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: () => required('DATABASE_URL'),
  jwtSecret: () => required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  githubToken: () => required('GITHUB_TOKEN'),
  githubOwner: () => required('GITHUB_OWNER'),
  githubTemplateRepo: process.env.GITHUB_TEMPLATE_REPO ?? 'lumi-tasks-api',
  pollPrIntervalMs: Number(process.env.POLL_PR_INTERVAL_MS ?? 30_000),
  pollCiIntervalMs: Number(process.env.POLL_CI_INTERVAL_MS ?? 60_000),
  pollMaxAttempts: Number(process.env.POLL_MAX_ATTEMPTS ?? 120),
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  llmChatModel: process.env.LLM_CHAT_MODEL ?? 'claude-haiku-4-5',
  llmReviewModel: process.env.LLM_REVIEW_MODEL ?? 'claude-sonnet-4-6',
};
