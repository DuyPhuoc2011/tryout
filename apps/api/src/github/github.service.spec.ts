import { Test } from '@nestjs/testing';
import { GitHubService } from './github.service';

const mockOctokit = {
  rest: {
    repos: {
      addCollaborator: jest.fn(),
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
          useFactory: () => new GitHubService('fake-token', 'test-owner'),
        },
      ],
    }).compile();
    service = moduleRef.get(GitHubService);
  });

  describe('addRepoCollaborator', () => {
    it('invites the user with read-only (pull) permission', async () => {
      mockOctokit.rest.repos.addCollaborator.mockResolvedValue({ data: {} });

      await service.addRepoCollaborator('test-owner', 'scenario-pg-disk-full', 'octocat');

      expect(mockOctokit.rest.repos.addCollaborator).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'scenario-pg-disk-full',
        username: 'octocat',
        permission: 'pull',
      });
    });
  });
});
