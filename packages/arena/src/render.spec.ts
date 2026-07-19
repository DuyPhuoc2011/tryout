import { renderTfvars } from './render';
import type { DesignConfig } from './schema';

const design: DesignConfig = {
  schema_version: 1,
  api: {
    platform: 'cloudrun',
    min_instances: 1,
    max_instances: 10,
    concurrency: 80,
    cpu: 1,
    memory: '1Gi',
  },
  workers: { placement: 'separate_service', min_instances: 1 },
  cache: { enabled: true, tier: 'basic-1gb' },
  db: { tier: 'small' },
};

describe('renderTfvars', () => {
  it('renders the expected variables for a split-worker design', () => {
    expect(renderTfvars(design, 'env-abc123')).toEqual({
      environment_id: 'env-abc123',
      api_min_instances: 1,
      api_max_instances: 10,
      api_concurrency: 80,
      api_cpu: 1,
      api_memory: '1Gi',
      worker_service_enabled: true,
      worker_min_instances: 1,
      worker_max_instances: 10,
      cache_enabled: true,
      cache_tier: 'basic-1gb',
      db_tier: 'small',
    });
  });

  it('disables the worker service when workers run in-process', () => {
    const inProcess: DesignConfig = {
      ...design,
      workers: { placement: 'in_process', min_instances: 0 },
    };
    const vars = renderTfvars(inProcess, 'env-abc123');
    expect(vars.worker_service_enabled).toBe(false);
    expect(vars.worker_min_instances).toBe(0);
  });

  it('emits no cache tier effect when the cache is disabled', () => {
    const noCache: DesignConfig = {
      ...design,
      cache: { enabled: false, tier: 'basic-1gb' },
    };
    expect(renderTfvars(noCache, 'env-abc123').cache_enabled).toBe(false);
  });

  it('emits only known variable keys', () => {
    const allowed = new Set([
      'environment_id',
      'api_min_instances',
      'api_max_instances',
      'api_concurrency',
      'api_cpu',
      'api_memory',
      'worker_service_enabled',
      'worker_min_instances',
      'worker_max_instances',
      'cache_enabled',
      'cache_tier',
      'db_tier',
    ]);
    for (const key of Object.keys(renderTfvars(design, 'env-abc123'))) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  it('rejects an environment id that is not a safe slug', () => {
    expect(() => renderTfvars(design, 'env abc; rm -rf /')).toThrow(/environmentId/);
    expect(() => renderTfvars(design, '')).toThrow(/environmentId/);
  });
});
