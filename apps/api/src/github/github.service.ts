import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GitHubService {
  private readonly octokit: Octokit;

  constructor(
    private readonly token: string,
    private readonly owner: string,
  ) {
    this.octokit = new Octokit({ auth: token });
  }

  /** Invite a buyer to a scenario content repo with read-only access. */
  async addRepoCollaborator(owner: string, repo: string, username: string): Promise<void> {
    await this.octokit.rest.repos.addCollaborator({
      owner,
      repo,
      username,
      permission: 'pull',
    });
  }
}
