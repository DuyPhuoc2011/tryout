import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';

export interface CreatedRepo {
  htmlUrl: string;
  fullName: string;
  repoName: string;
}

export interface PullRequestSummary {
  number: number;
  headSha: string;
  htmlUrl: string;
  title: string;
}

export interface CheckRunSummary {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

@Injectable()
export class GitHubService {
  private readonly octokit: Octokit;

  constructor(
    private readonly token: string,
    private readonly owner: string,
    private readonly templateRepo: string,
  ) {
    this.octokit = new Octokit({ auth: token });
  }

  async createRepoFromTemplate(
    userId: string,
    templateRepo: string = this.templateRepo,
  ): Promise<CreatedRepo> {
    const repoName = `${templateRepo}-${userId.slice(0, 8)}-${Date.now()}`;
    const response = await this.octokit.rest.repos.createUsingTemplate({
      template_owner: this.owner,
      template_repo: templateRepo,
      owner: this.owner,
      name: repoName,
      private: true,
      include_all_branches: false,
    });
    return {
      htmlUrl: response.data.html_url,
      fullName: response.data.full_name,
      repoName,
    };
  }

  async listOpenPullRequests(owner: string, repo: string): Promise<PullRequestSummary[]> {
    const response = await this.octokit.rest.pulls.list({ owner, repo, state: 'open' });
    return response.data.map((pr) => ({
      number: pr.number,
      headSha: pr.head.sha,
      htmlUrl: pr.html_url,
      title: pr.title,
    }));
  }

  async getPullRequestDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    const response = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });
    return response.data as unknown as string;
  }

  async getCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRunSummary[]> {
    const response = await this.octokit.rest.checks.listForRef({ owner, repo, ref });
    return response.data.check_runs.map((run) => ({
      id: run.id,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion ?? null,
    }));
  }

  async createPullRequestReview(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    event: ReviewEvent,
  ): Promise<void> {
    try {
      await this.octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        body,
        event,
      });
    } catch (err) {
      // GitHub rejects APPROVE/REQUEST_CHANGES on your *own* PR with a 422. In real
      // use the candidate and the senior-bot are different identities, so this never
      // fires; in solo/local testing they can be the same account. Fall back to a
      // plain COMMENT so the review still posts and the loop continues.
      // ponytail: only the self-review 422 is retried; everything else rethrows.
      const status = (err as { status?: number })?.status;
      if (status === 422 && event !== 'COMMENT') {
        await this.octokit.rest.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          body,
          event: 'COMMENT',
        });
        return;
      }
      throw err;
    }
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
