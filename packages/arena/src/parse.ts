import { parse as parseYaml } from 'yaml';
import { designSchema, type DesignConfig } from './schema';

export interface ParseError {
  /** Dotted path to the offending field, or 'document' for whole-file failures. */
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; design: DesignConfig }
  | { ok: false; errors: ParseError[] };

/** Upper bound on input size (characters). A design file is a few hundred
 *  bytes; anything larger is either a mistake or an attempt to exhaust the
 *  parser. */
const MAX_INPUT_LENGTH = 16 * 1024;

/** Upper bound on a single error's `path`/`message` once rendered onto a
 *  customer pull request. Both the YAML parser and Zod interpolate
 *  attacker-controlled text verbatim into their output, so neither is
 *  trusted as-is. */
const MAX_TEXT_LENGTH = 300;
const TRUNCATION_MARKER = '... [truncated]';

/** True for ASCII control characters (code points 0-31) and DEL (127) —
 *  anything that could break a single-line rendering, such as newlines
 *  or tabs. */
function isControlCharCode(code: number): boolean {
  return code <= 31 || code === 127;
}

function escapeControlChar(char: string, code: number): string {
  if (char === '\n') return '\\n';
  if (char === '\r') return '\\r';
  if (char === '\t') return '\\t';
  return `\\x${code.toString(16).padStart(2, '0')}`;
}

/**
 * Make attacker-influenced text safe to render as a single line in a
 * customer-facing pull request comment: escape control characters (so a
 * message can never inject extra lines or spoof additional entries) and
 * cap the length (so a crafted document cannot blow up the rendered output).
 */
function sanitizeText(text: string): string {
  let singleLine = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    singleLine += isControlCharCode(code) ? escapeControlChar(char, code) : char;
  }

  if (singleLine.length <= MAX_TEXT_LENGTH) {
    return singleLine;
  }

  return singleLine.slice(0, MAX_TEXT_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

function sanitizeError(error: ParseError): ParseError {
  return { path: sanitizeText(error.path), message: sanitizeText(error.message) };
}

/**
 * Parse and validate an untrusted design.yaml.
 *
 * Never throws: every failure is returned as a buyer-facing message, because
 * the caller renders these onto a pull request rather than handling exceptions.
 */
export function parseDesign(raw: string): ParseResult {
  // The size cap gates all further string work, including trim() below.
  if (raw.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      errors: [{ path: 'document', message: 'design.yaml exceeds the 16KB limit' }],
    };
  }

  if (raw.trim().length === 0) {
    return { ok: false, errors: [{ path: 'document', message: 'design.yaml is empty' }] };
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw, { maxAliasCount: 100 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unparseable';
    return {
      ok: false,
      errors: [sanitizeError({ path: 'document', message: `YAML error: ${message}` })],
    };
  }

  const result = designSchema.safeParse(doc);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) =>
        sanitizeError({
          path: issue.path.length > 0 ? issue.path.join('.') : 'document',
          message: issue.message,
        }),
      ),
    };
  }

  return { ok: true, design: result.data };
}
