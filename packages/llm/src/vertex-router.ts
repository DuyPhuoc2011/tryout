import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type { GenerateRequest, GenerateResult, LlmRouter } from './router';
import { generateWithClient } from './generate';

export interface VertexLlmRouterOptions {
  // GCP region the Claude model is served from, e.g. 'us-east5'.
  region: string;
  // GCP project id. Falls back to ADC / metadata if omitted.
  projectId?: string;
  // On Vertex, model ids are publisher/region-pinned (e.g. 'claude-sonnet-4-6@<date>'),
  // so these are required — there is no sensible cross-provider default.
  chatModel: string;
  reviewModel: string;
}

/**
 * Same agents, same prompts — Claude served through Vertex AI instead of the
 * direct API. Differs from AnthropicLlmRouter ONLY in the client + auth:
 * AnthropicVertex authenticates via Google Application Default Credentials
 * (service account / metadata server), not an ANTHROPIC_API_KEY.
 */
export class VertexLlmRouter implements LlmRouter {
  private readonly client: AnthropicVertex;
  private readonly chatModel: string;
  private readonly reviewModel: string;

  constructor(options: VertexLlmRouterOptions) {
    this.client = new AnthropicVertex({
      region: options.region,
      projectId: options.projectId,
    });
    this.chatModel = options.chatModel;
    this.reviewModel = options.reviewModel;
  }

  generate(request: GenerateRequest): Promise<GenerateResult> {
    return generateWithClient(this.client, request, {
      chatModel: this.chatModel,
      reviewModel: this.reviewModel,
    });
  }
}
