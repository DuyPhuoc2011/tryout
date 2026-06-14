export type LlmRole = 'pm' | 'senior' | 'grader';
export type TaskComplexity = 'chat' | 'review' | 'grade';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  role: LlmRole;
  taskComplexity: TaskComplexity;
  messages: LlmMessage[];
  context?: Record<string, unknown>;
  // Structured-output schema (used by the grader at M4).
  responseSchema?: unknown;
}

export interface GenerateResult {
  content: string;
  raw?: unknown;
}

export interface LlmRouter {
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Placeholder router. Real provider adapters + routing policy land at M2.
 * Throwing here makes accidental early use loud rather than silent.
 */
export class NotImplementedLlmRouter implements LlmRouter {
  async generate(): Promise<GenerateResult> {
    throw new Error('LlmRouter is not implemented yet (built at M2).');
  }
}
