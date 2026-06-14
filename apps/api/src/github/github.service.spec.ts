import { Test } from '@nestjs/testing';
import { GitHubService } from './github.service';

const mockOctokit = {
  rest: {
    repos: {
      createUsingTemplate: jest.fn(),
    },
    pulls: {
      list: jest.fn(),
      get: jest.fn(),
    },
    checks: {
      listForRef: jest.fn(),
    },
  },
};

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => mockOctokit),
}));

describe('GitHubService', () => {
  let service: GitHubService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: GitHubService,
          useFactory: () =>
            new GitHubService('fake-token', 'test-owner', 'lumi-tasks-api'),
        },
      ],
    }).compile();
    service = moduleRef.get(GitHubService);
  });

  describe('createRepoFromTemplate', () => {
    it('calls createUsingTemplate with the correct params and returns the repo URL', async () => {
      mockOctokit.rest.repos.createUsingTemplate.mockResolvedValue({
        data: { html_url: 'https://github.com/test-owner/lumi-tasks-abc123', full_name: 'test-owner/lumi-tasks-abc123' },
      });

      const result = await service.createRepoFromTemplate('user-id-abc123');

      expect(mockOctokit.rest.repos.createUsingTemplate).toHaveBeenCalledWith({
        template_owner: 'test-owner',
        template_repo: 'lumi-tasks-api',
        owner: 'test-owner',
        name: expect.stringContaining('lumi-tasks-'),
        private: true,
        include_all_branches: false,
      });
      expect(result.htmlUrl).toBe('https://github.com/test-owner/lumi-tasks-abc123');
      expect(result.fullName).toBe('test-owner/lumi-tasks-abc123');
    });
  });

  describe('listOpenPullRequests', () => {
    it('returns open pull requests', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 1, head: { sha: 'abc' }, html_url: 'https://github.com/test-owner/repo/pull/1', title: 'My PR' }],
      });

      const result = await service.listOpenPullRequests('test-owner', 'my-repo');

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        state: 'open',
      });
      expect(result).toHaveLength(1);
      expect(result[0].number).toBe(1);
      expect(result[0].headSha).toBe('abc');
    });
  });

  describe('getPullRequestDiff', () => {
    it('returns the diff string', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: 'diff --git a/file b/file\n...' });

      const diff = await service.getPullRequestDiff('test-owner', 'my-repo', 1);

      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        pull_number: 1,
        mediaType: { format: 'diff' },
      });
      expect(diff).toContain('diff --git');
    });
  });

  describe('getCheckRuns', () => {
    it('returns check run summaries', async () => {
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { id: 1, name: 'CI', status: 'completed', conclusion: 'success' },
          ],
        },
      });

      const result = await service.getCheckRuns('test-owner', 'my-repo', 'abc123');

      expect(mockOctokit.rest.checks.listForRef).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'my-repo',
        ref: 'abc123',
      });
      expect(result[0].status).toBe('completed');
      expect(result[0].conclusion).toBe('success');
    });
  });
});
