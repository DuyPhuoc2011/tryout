import Anthropic from '@anthropic-ai/sdk';
import type {
  GenerateRequest,
  GenerateResult,
  LlmRouter,
  TaskComplexity,
} from './router';

export interface AnthropicLlmRouterOptions {
  apiKey: string;
  chatModel?: string;
  reviewModel?: string;
}

const DEFAULT_CHAT_MODEL = 'claude-haiku-4-5';
const DEFAULT_REVIEW_MODEL = 'claude-sonnet-4-6';

const MAX_TOKENS: Record<TaskComplexity, number> = {
  chat: 1024,
  review: 2048,
  grade: 2048,
};

export class AnthropicLlmRouter implements LlmRouter {
  private readonly client: Anthropic;
  private readonly chatModel: string;
  private readonly reviewModel: string;

  constructor(options: AnthropicLlmRouterOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.chatModel = options.chatModel ?? DEFAULT_CHAT_MODEL;
    this.reviewModel = options.reviewModel ?? DEFAULT_REVIEW_MODEL;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const system = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const model =
      request.taskComplexity === 'chat' ? this.chatModel : this.reviewModel;

    const response = await this.client.messages.create({
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
}
