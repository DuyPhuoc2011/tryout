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
  // Cost guard: max scenario runs a single user can start per rolling 24h.
  // Each run burns LLM tokens (PM intro, review, grade) + a GitHub repo.
  dailyRunLimit: Number(process.env.DAILY_RUN_LIMIT ?? 3),
  // Static bearer for the read-only usage-metrics endpoint. Unset => endpoint
  // is disabled (returns 403). This is the Phase-2 (institutions) traction data.
  metricsToken: process.env.METRICS_TOKEN,
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),
  llmChatModel: process.env.LLM_CHAT_MODEL ?? 'claude-haiku-4-5',
  llmReviewModel: process.env.LLM_REVIEW_MODEL ?? 'claude-sonnet-4-6',
  // 'anthropic' (direct API, default) | 'vertex' (Claude via Vertex AI)
  // | 'openai' (any OpenAI-compatible endpoint: Gemini, Groq, Ollama...).
  llmProvider: process.env.LLM_PROVIDER ?? 'anthropic',
  vertexRegion: () => required('VERTEX_REGION'),
  vertexProjectId: process.env.VERTEX_PROJECT_ID,
  openaiApiKey: () => required('OPENAI_API_KEY'),
  openaiBaseUrl: () => required('OPENAI_BASE_URL'),
  stripeSecretKey: () => required('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: () => required('STRIPE_WEBHOOK_SECRET'),
  // Base URL of the web app, used for Stripe success/cancel redirects.
  webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
};
