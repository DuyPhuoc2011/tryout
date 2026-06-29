import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { copyDir, overlayDir, applyMutation, listFiles, mkTemp } from '../src/fsutil.js';

const temps: string[] = [];
function tmp() { const d = mkTemp('fsutil'); temps.push(d); return d; }
afterEach(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('fsutil', () => {
  it('copyDir + overlayDir merges by path, overlay wins', () => {
    const src = tmp(), ovl = tmp(), dst = tmp();
    fs.mkdirSync(path.join(src, 'a'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a', 'x.txt'), 'stub');
    fs.writeFileSync(path.join(src, 'keep.txt'), 'keep');
    fs.mkdirSync(path.join(ovl, 'a'), { recursive: true });
    fs.writeFileSync(path.join(ovl, 'a', 'x.txt'), 'solved');

    copyDir(src, dst);
    overlayDir(ovl, dst);

    expect(fs.readFileSync(path.join(dst, 'a', 'x.txt'), 'utf8')).toBe('solved');
    expect(fs.readFileSync(path.join(dst, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('applyMutation does a literal replace in a file', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'f.py'), 'hello FIND world');
    applyMutation(dir, { file: 'f.py', find: 'FIND', replace: 'GONE', expect_fail: '' });
    expect(fs.readFileSync(path.join(dir, 'f.py'), 'utf8')).toBe('hello GONE world');
  });

  it('listFiles returns relative paths, excluding a named dir', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sub', 'a.txt'), '1');
    fs.mkdirSync(path.join(dir, 'skip'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skip', 'b.txt'), '2');
    const files = listFiles(dir, ['skip']).sort();
    expect(files).toEqual([path.join('sub', 'a.txt')]);
  });
});
