import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import type { Db } from '@tryout/db';
import { schema } from '@tryout/db';
import type { AuthResponse, PublicUser } from '@tryout/shared';
import { DRIZZLE } from '../db/db.module';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
  ) {}

  async signup(email: string, password: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase().trim();
    const existing = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, normalized))
      .limit(1);

    if (existing.length > 0) {
      // Generic message — do not confirm whether the email is registered (spec §7).
      throw new ConflictException('Unable to create an account with those details.');
    }

    const passwordHash = await this.passwords.hash(password);
    const [user] = await this.db
      .insert(schema.users)
      .values({ email: normalized, passwordHash })
      .returning();

    return this.toAuthResponse(user.id, user.email, user.createdAt);
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    const normalized = email.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, normalized))
      .limit(1);

    const ok =
      user?.passwordHash != null &&
      (await this.passwords.verify(password, user.passwordHash));

    if (!ok) {
      // Same message for "no such user" and "wrong password" — no enumeration.
      throw new UnauthorizedException('Invalid email or password.');
    }

    return this.toAuthResponse(user.id, user.email, user.createdAt);
  }

  private async toAuthResponse(
    id: string,
    email: string,
    createdAt: Date,
  ): Promise<AuthResponse> {
    const token = await this.jwt.signAsync({ sub: id, email });
    const publicUser: PublicUser = {
      id,
      email,
      createdAt: createdAt.toISOString(),
    };
    return { token, user: publicUser };
  }
}
