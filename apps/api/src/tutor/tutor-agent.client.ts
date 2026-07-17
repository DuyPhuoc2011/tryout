import { Injectable, BadGatewayException } from '@nestjs/common';
import { env } from '../config/env';

export interface AgentTurnRequest {
  scenario: { title: string; tutor_brief: string };
  phase: string | null;
  history: { role: string; content: string }[];
  message: string;
}

export interface AgentTurnResponse {
  reply: string;
  phase: string;
}

@Injectable()
export class TutorAgentClient {
  async turn(payload: AgentTurnRequest): Promise<AgentTurnResponse> {
    let res: Response;
    try {
      res = await fetch(`${env.tutorAgentUrl}/agent/turn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': env.tutorAgentToken(),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new BadGatewayException('Tutor agent unreachable');
    }
    if (!res.ok) {
      throw new BadGatewayException(`Tutor agent error (${res.status})`);
    }
    return (await res.json()) as AgentTurnResponse;
  }
}
