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
