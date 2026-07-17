import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { schema, type Db } from '@tryout/db';
import { DRIZZLE } from '../db/db.module';
import { env } from '../config/env';
import { TutorAgentClient } from './tutor-agent.client';

const OWNED_STATUSES = ['invite_sent', 'paid', 'invite_failed'] as const;

export interface TutorMessageView {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class TutorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly agent: TutorAgentClient,
  ) {}

  private async assertOwnership(userId: string, listingId: string): Promise<void> {
    const [owned] = await this.db
      .select({ id: schema.purchases.id })
      .from(schema.purchases)
      .where(
        and(
          eq(schema.purchases.userId, userId),
          eq(schema.purchases.listingId, listingId),
          inArray(schema.purchases.status, [...OWNED_STATUSES]),
        ),
      )
      .limit(1);
    if (!owned) throw new ForbiddenException('You do not own this scenario');
  }

  async getThread(
    userId: string,
    listingId: string,
  ): Promise<{ phase: string; messages: TutorMessageView[] }> {
    await this.assertOwnership(userId, listingId);
    const [thread] = await this.db
      .select({ phase: schema.tutorThreads.phase })
      .from(schema.tutorThreads)
      .where(
        and(
          eq(schema.tutorThreads.userId, userId),
          eq(schema.tutorThreads.listingId, listingId),
        ),
      )
      .limit(1);
    const messages = await this.db
      .select({
        id: schema.tutorMessages.id,
        role: schema.tutorMessages.role,
        content: schema.tutorMessages.content,
        createdAt: schema.tutorMessages.createdAt,
      })
      .from(schema.tutorMessages)
      .where(
        and(
          eq(schema.tutorMessages.userId, userId),
          eq(schema.tutorMessages.listingId, listingId),
        ),
      )
      .orderBy(asc(schema.tutorMessages.createdAt));
    return { phase: thread?.phase ?? 'orient', messages };
  }

  async postMessage(
    userId: string,
    listingId: string,
    content: string,
  ): Promise<{ reply: string; phase: string }> {
    await this.assertOwnership(userId, listingId);
    await this.enforceCostGuard(userId);

    const [listing] = await this.db
      .select({
        title: schema.scenarioListings.title,
        tutorBrief: schema.scenarioListings.tutorBrief,
      })
      .from(schema.scenarioListings)
      .where(eq(schema.scenarioListings.id, listingId))
      .limit(1);
    if (!listing) throw new ForbiddenException('You do not own this scenario');
    if (!listing.tutorBrief) {
      throw new UnprocessableEntityException('Tutor not available for this scenario');
    }

    const { phase, messages } = await this.getThread(userId, listingId);
    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    const result = await this.agent.turn({
      scenario: { title: listing.title, tutor_brief: listing.tutorBrief },
      phase,
      history,
      message: content,
    });

    await this.db.insert(schema.tutorMessages).values([
      { userId, listingId, role: 'user', content },
      { userId, listingId, role: 'assistant', content: result.reply },
    ]);
    await this.upsertPhase(userId, listingId, result.phase);

    return { reply: result.reply, phase: result.phase };
  }

  private async enforceCostGuard(userId: string): Promise<void> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.db
      .select({ id: schema.tutorMessages.id })
      .from(schema.tutorMessages)
      .where(
        and(
          eq(schema.tutorMessages.userId, userId),
          eq(schema.tutorMessages.role, 'user'),
          gt(schema.tutorMessages.createdAt, since),
        ),
      );
    if (rows.length >= env.tutorDailyMessageLimit) {
      throw new HttpException(
        'Daily tutor message limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async upsertPhase(
    userId: string,
    listingId: string,
    phase: string,
  ): Promise<void> {
    await this.db
      .insert(schema.tutorThreads)
      .values({ userId, listingId, phase, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.tutorThreads.userId, schema.tutorThreads.listingId],
        set: { phase, updatedAt: new Date() },
      });
  }
}
