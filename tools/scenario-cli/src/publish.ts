import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { loadManifest } from './manifest.js';
import { templateDir } from './paths.js';
import { copyDir, mkTemp } from './fsutil.js';

function sh(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, stdio: 'pipe', shell: true as never }).toString();
}

export async function publishScenario(id: string): Promise<void> {
  const m = loadManifest(id);
  const owner = process.env.GITHUB_OWNER;
  if (!owner) throw new Error('GITHUB_OWNER not set');
  const repo = `${owner}/${m.repo.template_ref}`;

  // Build a clean student copy: template/ only.
  const staging = mkTemp(`publish-${m.repo.template_ref}`);
  copyDir(templateDir(id), staging);

  // Init a fresh git repo and commit.
  sh('git init -q', staging);
  sh('git checkout -q -B main', staging);
  sh('git add .', staging);
  sh(`git -c user.email=bot@tryout -c user.name=tryout commit -q -m "scenario template: ${m.title}"`, staging);

  // Create the repo if it doesn't exist yet.
  let exists = true;
  try { sh(`gh repo view ${repo}`); } catch { exists = false; }
  if (!exists) {
    sh(`gh repo create ${repo} --private --disable-wiki`);
  }

  // Push (force — the template content is authoritative from the scenario folder).
  sh(`git remote add origin https://github.com/${repo}.git`, staging);
  sh('git push -q --force origin main', staging);

  // Mark as template (idempotent).
  sh(`gh repo edit ${repo} --template`);

  fs.rmSync(staging, { recursive: true, force: true });
  console.log(`published ${repo} (is_template=true), solution/ excluded`);
}
