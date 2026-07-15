import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class CheckoutDto {
  @IsUUID()
  listingId!: string;

  // GitHub username rules: alphanumeric and single hyphens, 1-39 chars.
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/)
  githubUsername?: string;
}
