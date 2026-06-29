import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function mkTemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

/** Recursively list files as paths relative to `root`, skipping any top-level dir in `exclude`. */
export function listFiles(root: string, exclude: string[] = []): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (rel === '' && exclude.includes(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(abs, r);
      else out.push(r);
    }
  };
  walk(root, '');
  return out;
}

export function copyDir(src: string, dst: string): void {
  fs.cpSync(src, dst, { recursive: true });
}

/** Copy every file from `overlay` into `dst`, overwriting by relative path. */
export function overlayDir(overlay: string, dst: string): void {
  if (!fs.existsSync(overlay)) return;
  for (const rel of listFiles(overlay)) {
    const target = path.join(dst, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(overlay, rel), target);
  }
}

export function applyMutation(
  dir: string,
  mut: { file: string; find: string; replace: string; expect_fail: string },
): void {
  const target = path.join(dir, mut.file);
  const content = fs.readFileSync(target, 'utf8');
  if (!content.includes(mut.find)) {
    throw new Error(`mutation find-string absent in ${mut.file}`);
  }
  fs.writeFileSync(target, content.split(mut.find).join(mut.replace));
}
