import fs from 'node:fs';
import path from 'node:path';
import { loadManifest } from './manifest.js';
import { validateManifest, type TemplateReader } from './validate.js';
import { runGate } from './gate.js';
import { seedScenario } from './seed.js';
import { publishScenario } from './publish.js';
import { templateDir, solutionDir } from './paths.js';
import { listFiles } from './fsutil.js';

function dirReader(root: string): TemplateReader {
  return {
    exists: (rel) => fs.existsSync(path.join(root, rel)),
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
  };
}

/** template/ overlaid by solution/ (solution wins) — mirrors what the gate runs. */
function mergedReader(id: string): TemplateReader {
  const t = templateDir(id);
  const s = solutionDir(id);
  const pick = (rel: string) => (fs.existsSync(path.join(s, rel)) ? path.join(s, rel) : path.join(t, rel));
  return {
    exists: (rel) => fs.existsSync(path.join(s, rel)) || fs.existsSync(path.join(t, rel)),
    read: (rel) => fs.readFileSync(pick(rel), 'utf8'),
  };
}

function doValidate(id: string): string[] {
  const m = loadManifest(id); // throws on schema errors
  const solFiles = fs.existsSync(solutionDir(id)) ? listFiles(solutionDir(id)) : [];
  return validateManifest(m, dirReader(templateDir(id)), mergedReader(id), solFiles);
}

function doGate(id: string) {
  const m = loadManifest(id);
  return runGate({
    templateDir: templateDir(id),
    solutionDir: solutionDir(id),
    testCmd: m.gate.test_cmd,
    mutations: m.gate.mutations,
  });
}

async function main() {
  const [cmd, id] = process.argv.slice(2);
  if (!cmd || !id) {
    console.error('usage: scenario <validate|gate|publish|seed|release> <id>');
    process.exit(2);
  }

  const validate = () => {
    const problems = doValidate(id);
    if (problems.length) {
      console.error(`validate FAILED for ${id}:\n` + problems.map((p) => `  - ${p}`).join('\n'));
      process.exit(1);
    }
    console.log(`validate OK: ${id}`);
  };

  const gate = () => {
    const res = doGate(id);
    for (const s of res.stages) {
      console.log(`  [${s.ok ? 'PASS' : 'FAIL'}] ${s.name}${s.ok ? '' : ' — ' + s.detail}`);
    }
    if (!res.ok) {
      console.error(`gate FAILED for ${id}`);
      process.exit(1);
    }
    console.log(`gate OK: ${id}`);
  };

  switch (cmd) {
    case 'validate':
      validate();
      break;
    case 'gate':
      validate();
      gate();
      break;
    case 'seed':
      await seedScenario(id);
      break;
    case 'publish':
      await publishScenario(id);
      break;
    case 'release':
      validate();
      gate(); // fail-closed: both exit(1) on failure before we ship
      await publishScenario(id);
      await seedScenario(id);
      console.log(`released ${id}`);
      break;
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
