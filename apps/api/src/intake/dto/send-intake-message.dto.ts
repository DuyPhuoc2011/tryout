import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendIntakeMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
