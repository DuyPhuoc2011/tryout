process.env.TUTOR_AGENT_TOKEN = 'test-token';

import { BadGatewayException } from '@nestjs/common';
import { TutorAgentClient, AgentTurnRequest } from './tutor-agent.client';

const payload: AgentTurnRequest = {
  scenario: { title: 'Disk Full', tutor_brief: 'brief' },
  phase: 'orient',
  history: [],
  message: 'where do I start?',
};

describe('TutorAgentClient', () => {
  let client: TutorAgentClient;

  beforeEach(() => {
    client = new TutorAgentClient();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('happy path: returns parsed reply/phase and sends internal-token header', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'hi', phase: 'detect' }),
    });

    const result = await client.turn(payload);

    expect(result).toEqual({ reply: 'hi', phase: 'detect' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('http://localhost:8000/agent/turn');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Internal-Token']).toBe('test-token');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it('network failure: rejects with BadGatewayException', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(client.turn(payload)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('non-ok response: rejects with BadGatewayException', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    await expect(client.turn(payload)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
