import Anthropic from '@anthropic-ai/sdk';
import type { GenerateRequest, GenerateResult, LlmRouter } from './router';
import { generateWithClient } from './generate';

export interface AnthropicLlmRouterOptions {
  apiKey: string;
  chatModel?: string;
  reviewModel?: string;
}

const DEFAULT_CHAT_MODEL = 'claude-haiku-4-5';
const DEFAULT_REVIEW_MODEL = 'claude-sonnet-4-6';

export class AnthropicLlmRouter implements LlmRouter {
  private readonly client: Anthropic;
  private readonly chatModel: string;
  private readonly reviewModel: string;

  constructor(options: AnthropicLlmRouterOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.chatModel = options.chatModel ?? DEFAULT_CHAT_MODEL;
    this.reviewModel = options.reviewModel ?? DEFAULT_REVIEW_MODEL;
  }

  generate(request: GenerateRequest): Promise<GenerateResult> {
    return generateWithClient(this.client, request, {
      chatModel: this.chatModel,
      reviewModel: this.reviewModel,
    });
  }
}
