import { fileURLToPath } from 'node:url';
import path from 'node:path';

// tools/scenario-cli/src/paths.ts -> repo root is three levels up from src.
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const SCENARIOS_DIR = path.join(REPO_ROOT, 'scenarios');

export function scenarioDir(id: string): string {
  return path.join(SCENARIOS_DIR, id);
}
export function manifestPath(id: string): string {
  return path.join(scenarioDir(id), 'scenario.json');
}
export function templateDir(id: string): string {
  return path.join(scenarioDir(id), 'template');
}
export function solutionDir(id: string): string {
  return path.join(scenarioDir(id), 'solution');
}
