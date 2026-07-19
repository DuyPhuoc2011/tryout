import { z } from 'zod';

/**
 * The complete legal design surface. Anything not expressed here is rejected.
 *
 * This schema is a security boundary, not a convenience: it is the control that
 * stops untrusted buyer input from reaching infrastructure credentials. Every
 * object is `.strict()` so unknown keys are errors, never silently ignored.
 */

export const SCHEMA_VERSION = 1;

const cpuSchema = z.union([z.literal(0.5), z.literal(1), z.literal(2)]);
const memorySchema = z.enum(['512Mi', '1Gi', '2Gi']);

const cloudRunApiSchema = z
  .object({
    platform: z.literal('cloudrun'),
    min_instances: z.number().int().min(0).max(5),
    max_instances: z.number().int().min(1).max(20),
    concurrency: z.number().int().min(1).max(250),
    cpu: cpuSchema,
    memory: memorySchema,
  })
  .strict()
  .refine((api) => api.max_instances >= api.min_instances, {
    message: 'max_instances must be greater than or equal to min_instances',
    path: ['max_instances'],
  })
  // Cloud Run requires a CPU floor for higher memory tiers: "A minimum of 0.5
  // vCPU is needed to set a memory limit greater than 512MiB. A minimum of 1
  // vCPU is needed to set a memory limit greater than 1GiB." Our cpu enum's
  // floor (0.5) already satisfies the >512MiB rule for every combination in
  // this schema, so the only illegal pairing within {0.5, 1, 2} x {512Mi,
  // 1Gi, 2Gi} is cpu: 0.5 with memory: 2Gi.
  // Source: https://cloud.google.com/run/docs/configuring/services/cpu
  // Verified: 2026-07-19.
  .refine((api) => api.memory !== '2Gi' || api.cpu >= 1, {
    message: 'memory: 2Gi requires cpu >= 1 (Cloud Run minimum vCPU for this memory tier)',
    path: ['cpu'],
  });

const workersSchema = z
  .object({
    // separate_deployment arrives with the GKE lever in a later milestone.
    placement: z.enum(['in_process', 'separate_service']),
    min_instances: z.number().int().min(0).max(3),
  })
  .strict();

const cacheSchema = z
  .object({
    enabled: z.boolean(),
    tier: z.enum(['basic-1gb', 'standard-1gb']),
  })
  .strict();

const dbSchema = z
  .object({
    tier: z.enum(['micro', 'small', 'medium']),
  })
  .strict();

export const designSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    api: cloudRunApiSchema,
    workers: workersSchema,
    cache: cacheSchema,
    db: dbSchema,
  })
  .strict()
  // Lives at the top level, not on either sub-schema, because it needs both
  // the api and workers blocks. Only meaningful when workers run as a
  // separate Cloud Run service: in-process workers share the api service's
  // instances, so there is no separate worker floor/ceiling pair to compare.
  // Without this, a schema-valid design can render worker_min_instances >
  // worker_max_instances (render.ts pins worker_max_instances to
  // api.max_instances), which Cloud Run rejects at apply time.
  .refine(
    (design) =>
      design.workers.placement !== 'separate_service' ||
      design.workers.min_instances <= design.api.max_instances,
    {
      message:
        'workers.min_instances must be less than or equal to api.max_instances when workers.placement is separate_service',
      path: ['workers', 'min_instances'],
    },
  );

export type DesignConfig = z.infer<typeof designSchema>;
