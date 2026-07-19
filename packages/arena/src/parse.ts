import { parse as parseYaml } from 'yaml';
import { designSchema, type DesignConfig } from './schema';
import { sanitizeText } from './text-safety';

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
