import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { ArenaTfvars } from '@tryout/arena';
import { env } from '../config/env';

const execFileAsync = promisify(execFile);

export type TerraformResult = { ok: true } | { ok: false; message: string };

/**
 * The only thing in the runner that touches Terraform, GCP, or the filesystem.
 *
 * It exists as an interface so every transition test runs without a Terraform
 * binary, a credential, or a network — the state machine is what has bugs, and
 * shelling out is what makes it untestable.
 */
export interface TerraformExecutor {
  apply(tfvars: ArenaTfvars): Promise<TerraformResult>;
  destroy(envSlug: string): Promise<TerraformResult>;
}

/** Injection token; the real implementation is bound in the runner module. */
export const TERRAFORM_EXECUTOR = Symbol('TERRAFORM_EXECUTOR');

/** Stderr is echoed back to a buyer in a later milestone, so it is bounded. */
const MAX_MESSAGE_LENGTH = 4000;

function failureMessage(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'stderr' in error && (error as { stderr?: unknown }).stderr
      ? String((error as { stderr: unknown }).stderr)
      : error instanceof Error
        ? error.message
        : 'terraform failed';

  return raw.slice(0, MAX_MESSAGE_LENGTH);
}

@Injectable()
export class RealTerraformExecutor implements TerraformExecutor {
  /**
   * Apply one buyer environment.
   *
   * `tfvars` is already validated by `parseTfvars` in the caller, and is
   * written to a file as JSON rather than assembled into `-var` flags: JSON
   * has one unambiguous encoding, whereas `-var key=value` string building is
   * where an injection would live if one were possible. Terraform itself is
   * spawned with an argument array through `execFile`, never a shell, so no
   * value here is ever parsed by /bin/sh.
   */
  async apply(tfvars: ArenaTfvars): Promise<TerraformResult> {
    return this.withVarFile(tfvars, (varFile) =>
      this.run(tfvars.environment_id, [
        'apply',
        '-input=false',
        '-auto-approve',
        '-no-color',
        '-lock-timeout=120s',
        `-var-file=${varFile}`,
      ]),
    );
  }

  /**
   * Destroy an environment by slug.
   *
   * Variables are still required for a destroy (Terraform evaluates the
   * config), but their values do not matter to what gets destroyed — the state
   * file does. `-refresh=false` is deliberately NOT set: a reaper that
   * destroys from stale state is how orphaned billable resources happen.
   */
  async destroy(envSlug: string): Promise<TerraformResult> {
    return this.withVarFile(destroyPlaceholderVars(envSlug), (varFile) =>
      this.run(envSlug, [
        'destroy',
        '-input=false',
        '-auto-approve',
        '-no-color',
        '-lock-timeout=120s',
        `-var-file=${varFile}`,
      ]),
    );
  }

  private async withVarFile(
    tfvars: ArenaTfvars,
    action: (varFile: string) => Promise<TerraformResult>,
  ): Promise<TerraformResult> {
    const dir = await mkdtemp(join(tmpdir(), 'arena-tf-'));
    const varFile = join(dir, 'env.tfvars.json');

    try {
      await writeFile(varFile, JSON.stringify(tfvars), { mode: 0o600 });
      return await action(varFile);
    } catch (error: unknown) {
      return { ok: false, message: failureMessage(error) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async run(envSlug: string, args: string[]): Promise<TerraformResult> {
    const cwd = env.arenaTerraformDir;
    const timeout = env.arenaTerraformTimeoutMs;

    // Terraform holds no persistent credentials of its own: the Cloud Run Job
    // runs as the arena-runner service account and both providers pick that
    // up from the metadata server / these variables.
    const childEnv = {
      ...process.env,
      TF_IN_AUTOMATION: '1',
      TF_INPUT: '0',
      TF_VAR_project_id: env.arenaProjectId(),
      TF_VAR_region: env.arenaRegion,
      TF_VAR_vpc_connector: env.arenaVpcConnector(),
      TF_VAR_runtime_service_account: env.arenaRuntimeServiceAccount(),
      TF_VAR_scenario_image: env.arenaScenarioImage(),
      TF_VAR_db_host: env.arenaDbHost(),
      TF_VAR_db_admin_user: env.arenaDbAdminUser,
      TF_VAR_db_admin_password: env.arenaDbAdminPassword(),
    };

    try {
      // Fresh init per invocation, because the backend prefix differs per
      // environment and a reused .terraform directory would point at whichever
      // environment ran last. -reconfigure makes that explicit rather than
      // letting Terraform prompt about a changed backend.
      await execFileAsync(
        'terraform',
        [
          'init',
          '-input=false',
          '-no-color',
          '-reconfigure',
          `-backend-config=bucket=${env.arenaStateBucket()}`,
          `-backend-config=prefix=arena/${envSlug}`,
        ],
        { cwd, timeout, env: childEnv, maxBuffer: 10 * 1024 * 1024 },
      );

      await execFileAsync('terraform', args, {
        cwd,
        timeout,
        env: childEnv,
        maxBuffer: 10 * 1024 * 1024,
      });

      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, message: failureMessage(error) };
    }
  }
}

/**
 * Terraform requires every declared variable to have a value even for a
 * destroy, where the values are irrelevant: the state file, not the config,
 * decides what is torn down. These are schema-valid filler for exactly that.
 */
function destroyPlaceholderVars(envSlug: string): ArenaTfvars {
  return {
    environment_id: envSlug,
    api_min_instances: 0,
    api_max_instances: 1,
    api_concurrency: 1,
    api_cpu: 1,
    api_memory: '512Mi',
    worker_service_enabled: false,
    worker_min_instances: 0,
    worker_max_instances: 1,
    cache_enabled: false,
    cache_tier: 'basic-1gb',
    db_tier: 'micro',
  };
}
