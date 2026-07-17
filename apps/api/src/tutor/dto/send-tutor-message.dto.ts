import { IsString, MinLength, MaxLength } from 'class-validator';

export class SendTutorMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
