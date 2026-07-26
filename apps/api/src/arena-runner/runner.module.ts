import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { RunnerService } from './runner.service';
import { RealTerraformExecutor, TERRAFORM_EXECUTOR } from './terraform-executor';

/**
 * The runner is a job, not part of the HTTP app: this module is never imported
 * by AppModule. It is compiled standalone in `main.ts` so the API process
 * never loads Terraform-shaped code or the credentials that go with it.
 */
@Module({
  imports: [DbModule],
  providers: [RunnerService, { provide: TERRAFORM_EXECUTOR, useClass: RealTerraformExecutor }],
})
export class RunnerModule {}
