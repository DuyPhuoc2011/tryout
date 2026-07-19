import { parseDesign } from './parse';

const validYaml = `
schema_version: 1
api:
  platform: cloudrun
  min_instances: 1
  max_instances: 10
  concurrency: 80
  cpu: 1
  memory: 1Gi
workers:
  placement: separate_service
  min_instances: 1
cache:
  enabled: true
  tier: basic-1gb
db:
  tier: small
`;

describe('parseDesign', () => {
  it('returns ok with the parsed config for valid YAML', () => {
    const result = parseDesign(validYaml);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.design.api.min_instances).toBe(1);
    expect(result.design.api.memory).toBe('1Gi');
  });

  it('returns an error, never throws, on malformed YAML', () => {
    const result = parseDesign('api: [unclosed');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0].message).toMatch(/yaml/i);
  });

  it('returns field-scoped errors for schema violations', () => {
    const bad = validYaml.replace('max_instances: 10', 'max_instances: 999');
    const result = parseDesign(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0].path).toBe('api.max_instances');
  });

  it('reports every schema violation, not only the first', () => {
    const bad = validYaml
      .replace('max_instances: 10', 'max_instances: 999')
      .replace('cpu: 1', 'cpu: 64');
    const result = parseDesign(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an error for empty input', () => {
    const result = parseDesign('');
    expect(result.ok).toBe(false);
  });

  it('does not throw on a YAML alias bomb', () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    ].join('\n');
    expect(() => parseDesign(bomb)).not.toThrow();
    expect(parseDesign(bomb).ok).toBe(false);
  });

  it('caps the unrecognized-keys message length regardless of attacker-supplied key count', () => {
    // Build the largest possible unrecognized-keys attack that still fits under
    // the 16KB input cap: many short unique extra top-level keys, each of
    // which Zod would otherwise echo verbatim into a single issue message.
    const lines: string[] = [];
    let i = 0;
    while (true) {
      const nextLine = `k${i}: 1`;
      const projected = validYaml.length + 1 + lines.join('\n').length + 1 + nextLine.length;
      if (projected > 16 * 1024) break;
      lines.push(nextLine);
      i++;
    }
    const bomb = `${validYaml}\n${lines.join('\n')}\n`;
    expect(bomb.length).toBeLessThanOrEqual(16 * 1024);
    expect(lines.length).toBeGreaterThan(1000);

    const result = parseDesign(bomb);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    const unrecognizedError = result.errors.find((e) => /unrecognized/i.test(e.message));
    expect(unrecognizedError).toBeDefined();
    expect(unrecognizedError!.message.length).toBeLessThanOrEqual(300);
  });

  it('caps an enum-violation message even when the attacker-supplied value is huge', () => {
    const scriptPayload = '<script>alert(1)</script>'.repeat(20);
    const bad = validYaml.replace('tier: small', `tier: "${scriptPayload}"`);
    const result = parseDesign(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    const dbError = result.errors.find((e) => e.path === 'db.tier');
    expect(dbError).toBeDefined();
    expect(dbError!.message.length).toBeLessThanOrEqual(300);
  });

  it('strips raw control characters from an enum-violation message so it stays single-line', () => {
    const bad = validYaml.replace('tier: small', 'tier: "evil\\nvalue\\tmore"');
    const result = parseDesign(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    const dbError = result.errors.find((e) => e.path === 'db.tier');
    expect(dbError).toBeDefined();
    expect(dbError!.message).not.toMatch(/\n/);
    expect(dbError!.message).not.toMatch(/\t/);
  });

  it('reports empty rather than a size error for whitespace-only input under the size cap', () => {
    const result = parseDesign('   \n\t  ');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0].message).toMatch(/empty/i);
  });
});
