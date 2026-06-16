import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class CreateRunDto {
  @IsUUID()
  scenarioId: string;

  @IsString()
  @IsNotEmpty()
  role: string;
}
