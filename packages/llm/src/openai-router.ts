import type {
  GenerateRequest,
  GenerateResult,
  LlmRouter,
  TaskComplexity,
} from './router';

export interface OpenAiCompatRouterOptions {
  apiKey: string;
  // OpenAI-compatible base, e.g. Gemini: https://generativelanguage.googleapis.com/v1beta/openai
  // Groq: https://api.groq.com/openai/v1   |   Ollama: http://localhost:11434/v1
  baseURL: string;
  chatModel: string;
  reviewModel: string;
}

const MAX_TOKENS: Record<TaskComplexity, number> = {
  chat: 1024,
  review: 2048,
  grade: 2048,
};

/**
 * Talks to any OpenAI-compatible /chat/completions endpoint (Gemini, Groq,
 * Ollama, OpenRouter, ...). Used for cheap/free local + dev testing; swap to
 * the Anthropic or Vertex router in production via LLM_PROVIDER. Plain fetch,
 * no SDK — the chat/completions contract is stable and our LlmMessage roles
 * (system|user|assistant) map 1:1 onto it.
 */
export class OpenAiCompatLlmRouter implements LlmRouter {
  constructor(private readonly options: OpenAiCompatRouterOptions) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const model =
      request.taskComplexity === 'chat'
        ? this.options.chatModel
        : this.options.reviewModel;

    const res = await fetch(`${this.options.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS[request.taskComplexity],
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI-compat request failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, raw: data };
  }
}
