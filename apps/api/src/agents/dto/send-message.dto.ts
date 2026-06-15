import { IsIn, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsIn(['pm', 'senior'])
  agentRole: 'pm' | 'senior';

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
