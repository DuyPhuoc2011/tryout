import { IsString, MaxLength, MinLength } from 'class-validator';

export class SubmitTurnDto {
  /**
   * Raw design.yaml text. The 16KB ceiling mirrors parseDesign's own cap so an
   * oversized body is refused at the edge rather than inside the parser.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(16 * 1024)
  design!: string;
}
