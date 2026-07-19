/**
 * `designSchema` is exported for tooling that needs schema introspection or
 * type inference (e.g. `z.infer<typeof designSchema>`) on an already-trusted
 * value. It is NOT a sanctioned entry point for untrusted input: calling
 * `designSchema.parse()` / `.safeParse()` directly on raw customer text
 * skips the 16KB size cap, the YAML alias-count limit, and the sanitization
 * that strips attacker-controlled control characters from error messages —
 * all of which live in `parseDesign`. `parseDesign` is the ONLY sanctioned
 * path for raw, untrusted `design.yaml` text; do not call `designSchema` on
 * it directly.
 */
export { designSchema, SCHEMA_VERSION, type DesignConfig } from './schema';
export { parseDesign, type ParseError, type ParseResult } from './parse';
export { renderTfvars, type ArenaTfvars } from './render';
export { costFromUsage, type Usage, type CostBreakdown } from './pricing';
export { GCP_RATES, type RateTable } from './rates';
export {
  scoreRun,
  type ProfilePar,
  type RunMetrics,
  type OpsEventResult,
  type ScoreFailure,
  type SloTargets,
  type Verdict,
} from './score';
