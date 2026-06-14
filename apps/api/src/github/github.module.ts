import { Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { env } from '../config/env';

@Module({
  providers: [
    {
      provide: GitHubService,
      useFactory: () =>
        new GitHubService(env.githubToken(), env.githubOwner(), env.githubTemplateRepo),
    },
  ],
  exports: [GitHubService],
})
export class GitHubModule {}
