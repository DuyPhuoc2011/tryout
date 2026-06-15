import { Module } from '@nestjs/common';
import { AnthropicLlmRouter, type LlmRouter } from '@tryout/llm';
import { env } from '../config/env';

export const LLM_ROUTER = Symbol('LLM_ROUTER');

@Module({
  providers: [
    {
      provide: LLM_ROUTER,
      useFactory: (): LlmRouter =>
        new AnthropicLlmRouter({
          apiKey: env.anthropicApiKey(),
          chatModel: env.llmChatModel,
          reviewModel: env.llmReviewModel,
        }),
    },
  ],
  exports: [LLM_ROUTER],
})
export class LlmModule {}
