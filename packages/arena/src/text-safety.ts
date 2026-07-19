/** Upper bound on a single piece of attacker-influenced text once rendered
 *  onto a customer-facing surface (a pull request comment, an error message,
 *  etc). Parsers, validators, and callers across this package interpolate
 *  attacker-controlled text verbatim into their output, so none of it is
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
 * Make attacker-influenced text safe to render as a single line on a
 * customer-facing surface: escape control characters (so a value can never
 * inject extra lines or spoof additional entries) and cap the length (so a
 * crafted value cannot blow up the rendered output).
 */
export function sanitizeText(text: string): string {
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
