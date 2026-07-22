import type { GenerateRequest, GenerateResult, TaskComplexity } from './router';

const MAX_TOKENS: Record<TaskComplexity, number> = {
  chat: 1024,
  review: 2048,
  grade: 2048,
};

/** Minimal slice of the Anthropic / AnthropicVertex client we depend on. */
export interface MessagesClient {
  messages: {
    create(body: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export interface ModelMap {
  chatModel: string;
  reviewModel: string;
}

/**
 * Shared request → response logic. Both the direct-API and Vertex routers
 * differ ONLY in which client they construct; the message shaping, model
 * routing, and text extraction are identical.
 */
export async function generateWithClient(
  client: MessagesClient,
  request: GenerateRequest,
  models: ModelMap,
): Promise<GenerateResult> {
  const system = request.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const messages = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const model = request.taskComplexity === 'chat' ? models.chatModel : models.reviewModel;

  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS[request.taskComplexity],
    system,
    messages,
  });

  const content = response.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return { content, raw: response };
}
