import { AnthropicLlmRouter } from './anthropic-router';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

describe('AnthropicLlmRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hello from the model' }],
    });
  });

  it('routes chat tasks to the chat model and extracts the system prompt', async () => {
    const router = new AnthropicLlmRouter({
      apiKey: 'fake',
      chatModel: 'claude-haiku-4-5',
      reviewModel: 'claude-sonnet-4-6',
    });

    const result = await router.generate({
      role: 'pm',
      taskComplexity: 'chat',
      messages: [
        { role: 'system', content: 'You are Mai.' },
        { role: 'user', content: 'Introduce yourself.' },
      ],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.model).toBe('claude-haiku-4-5');
    expect(arg.system).toContain('You are Mai.');
    expect(arg.messages).toEqual([{ role: 'user', content: 'Introduce yourself.' }]);
    expect(result.content).toBe('hello from the model');
  });

  it('routes review tasks to the review model', async () => {
    const router = new AnthropicLlmRouter({
      apiKey: 'fake',
      chatModel: 'claude-haiku-4-5',
      reviewModel: 'claude-sonnet-4-6',
    });

    await router.generate({
      role: 'senior',
      taskComplexity: 'review',
      messages: [{ role: 'user', content: 'review this diff' }],
    });

    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-6');
  });

  it('concatenates multiple text blocks in the response', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'text', text: 'part one ' },
        { type: 'tool_use', id: 'x', name: 'y', input: {} },
        { type: 'text', text: 'part two' },
      ],
    });
    const router = new AnthropicLlmRouter({ apiKey: 'fake' });

    const result = await router.generate({
      role: 'pm',
      taskComplexity: 'chat',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.content).toBe('part one part two');
  });
});
