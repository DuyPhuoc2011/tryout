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
