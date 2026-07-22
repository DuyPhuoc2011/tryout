import { Module } from '@nestjs/common';
import {
  AnthropicLlmRouter,
  VertexLlmRouter,
  OpenAiCompatLlmRouter,
  type LlmRouter,
} from '@tryout/llm';
import { env } from '../config/env';

export const LLM_ROUTER = Symbol('LLM_ROUTER');

/** Same agents/prompts; pick the transport via LLM_PROVIDER. */
function createRouter(): LlmRouter {
  if (env.llmProvider === 'vertex') {
    return new VertexLlmRouter({
      region: env.vertexRegion(),
      projectId: env.vertexProjectId,
      chatModel: env.llmChatModel,
      reviewModel: env.llmReviewModel,
    });
  }
  if (env.llmProvider === 'openai') {
    return new OpenAiCompatLlmRouter({
      apiKey: env.openaiApiKey(),
      baseURL: env.openaiBaseUrl(),
      chatModel: env.llmChatModel,
      reviewModel: env.llmReviewModel,
    });
  }
  return new AnthropicLlmRouter({
    apiKey: env.anthropicApiKey(),
    chatModel: env.llmChatModel,
    reviewModel: env.llmReviewModel,
  });
}

@Module({
  providers: [
    {
      provide: LLM_ROUTER,
      useFactory: createRouter,
    },
  ],
  exports: [LLM_ROUTER],
})
export class LlmModule {}
