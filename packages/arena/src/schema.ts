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
  .strict();

export type DesignConfig = z.infer<typeof designSchema>;
