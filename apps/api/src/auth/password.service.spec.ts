import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password to something other than the plaintext', async () => {
    const hash = await service.hash('correct horse');
    expect(hash).not.toBe('correct horse');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await service.hash('correct horse');
    await expect(service.verify('correct horse', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct horse');
    await expect(service.verify('wrong horse', hash)).resolves.toBe(false);
  });
});
