import { sanitizeText } from './text-safety';

// Mirrors the production constant (not exported, since it is an internal
// implementation detail): '... [truncated]' is 15 characters.
const TRUNCATION_MARKER = '... [truncated]';
const MAX_TEXT_LENGTH = 300;

describe('sanitizeText', () => {
  it('returns an empty string unchanged', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('passes through a string with no control characters unchanged', () => {
    const input = 'plain ascii text, nothing weird here! 123';
    expect(sanitizeText(input)).toBe(input);
  });

  it('escapes DEL (0x7f) the same way as other control characters', () => {
    // \x7f in a JS/TS string literal is the DEL character itself, not the
    // literal text "\x7f" -- exactly the raw control byte this function must
    // escape.
    const input = 'before\x7fafter';
    expect(sanitizeText(input)).toBe('before\\x7fafter');
  });

  describe('the 300-character cutoff', () => {
    it('leaves a 299-character string (just under the cutoff) untouched', () => {
      const input = 'a'.repeat(MAX_TEXT_LENGTH - 1);
      expect(sanitizeText(input)).toBe(input);
    });

    it('leaves a 300-character string (exactly at the cutoff) untouched', () => {
      const input = 'a'.repeat(MAX_TEXT_LENGTH);
      const result = sanitizeText(input);
      expect(result).toBe(input);
      expect(result.length).toBe(MAX_TEXT_LENGTH);
    });

    it('truncates a 301-character string (just over the cutoff)', () => {
      const input = 'a'.repeat(MAX_TEXT_LENGTH + 1);
      const result = sanitizeText(input);
      expect(result.length).toBe(MAX_TEXT_LENGTH);
      expect(result).toBe(
        'a'.repeat(MAX_TEXT_LENGTH - TRUNCATION_MARKER.length) + TRUNCATION_MARKER,
      );
    });
  });

  it('truncates a string that is under the raw 300-character cap but exceeds it once control-character expansion is applied', () => {
    // Each \x07 (BEL, code 7) expands to the 4-character escape "\x07", so a
    // string that is well under the raw-length cap can still cross the
    // rendered-length cap once every character expands 4x.
    const rawLength = 290; // under MAX_TEXT_LENGTH in raw character count...
    const input = '\x07'.repeat(rawLength);
    const result = sanitizeText(input);
    // ...but 290 * 4 = 1160 expanded characters, well over the cap.
    expect(result.length).toBe(MAX_TEXT_LENGTH);
    expect(result.endsWith(TRUNCATION_MARKER)).toBe(true);
  });
});
