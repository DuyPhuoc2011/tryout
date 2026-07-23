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
  githubToken: () => required('GITHUB_TOKEN'),
  githubOwner: () => required('GITHUB_OWNER'),
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
  // Tutor agent (Python LangGraph service).
  tutorAgentUrl: process.env.TUTOR_AGENT_URL ?? 'http://localhost:8000',
  tutorAgentToken: () => required('TUTOR_AGENT_TOKEN'),
  tutorDailyMessageLimit: Number(process.env.TUTOR_DAILY_MESSAGE_LIMIT ?? 50),
  // Arena runner (Cloud Run Job). Required only in the runner entrypoint —
  // the API process never reads these, and must not fail to boot without them.
  arenaStateBucket: () => required('ARENA_STATE_BUCKET'),
  arenaRegion: process.env.ARENA_REGION ?? 'us-central1',
  arenaProjectId: () => required('GOOGLE_CLOUD_PROJECT'),
  arenaVpcConnector: () => required('ARENA_VPC_CONNECTOR'),
  arenaRuntimeServiceAccount: () => required('ARENA_RUNTIME_SERVICE_ACCOUNT'),
  arenaScenarioImage: () => required('ARENA_SCENARIO_IMAGE'),
  arenaDbHost: () => required('ARENA_DB_HOST'),
  arenaDbAdminUser: process.env.ARENA_DB_ADMIN_USER ?? 'arena_admin',
  arenaDbAdminPassword: () => required('ARENA_DB_ADMIN_PASSWORD'),
  // Directory holding infra/terraform/arena-env, baked into the runner image.
  arenaTerraformDir: process.env.ARENA_TERRAFORM_DIR ?? '/app/terraform/arena-env',
  // Wall-clock ceiling for one terraform invocation.
  arenaTerraformTimeoutMs: Number(process.env.ARENA_TERRAFORM_TIMEOUT_MS ?? 10 * 60 * 1000),
};
