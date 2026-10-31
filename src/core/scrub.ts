import { Transform } from 'node:stream';
import { placeholder } from './refs';

/** Values shorter than this are not scrubbed: the false-positive rate would be absurd. */
export const MIN_SCRUB_LENGTH = 4;

export interface ScrubPattern {
  needle: string;
  replacement: string;
}

/**
 * Builds the list of strings that must never reach the agent: the raw value,
 * plus its common encodings (base64, URL-encoded, JSON-escaped).
 * Longest needles first so partial overlaps resolve to the full match.
 */
export function buildPatterns(values: Map<string, string>): ScrubPattern[] {
  const patterns: ScrubPattern[] = [];
  for (const [path, value] of values) {
    if (value.length < MIN_SCRUB_LENGTH) continue;
    const replacement = placeholder(path);
    const variants = new Set<string>([value]);
    variants.add(Buffer.from(value, 'utf-8').toString('base64'));
    variants.add(encodeURIComponent(value));
    variants.add(JSON.stringify(value).slice(1, -1));
    for (const line of value.split(/\r?\n/)) {
      if (line.length >= MIN_SCRUB_LENGTH) variants.add(line);
    }
    for (const v of variants) {
      if (v.length >= MIN_SCRUB_LENGTH) patterns.push({ needle: v, replacement });
    }
  }
  return patterns.sort((a, b) => b.needle.length - a.needle.length);
}

export function scrubString(text: string, patterns: ScrubPattern[]): string {
  let out = text;
  for (const { needle, replacement } of patterns) {
    out = out.split(needle).join(replacement);
  }
  return out;
}

/**
 * Transform stream that scrubs secrets even when a value is split across
 * two chunks: the tail (longest needle - 1 bytes) is held back until the
 * next chunk arrives or the stream ends.
 */
export function createScrubber(patterns: ScrubPattern[], idleFlushMs = 50): Transform {
  const holdback = Math.max(0, patterns.reduce((m, p) => Math.max(m, p.needle.length), 0) - 1);
  let carry = '';
  let timer: NodeJS.Timeout | undefined;

  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (timer) clearTimeout(timer);
      const text = carry + chunk.toString('utf-8');
      if (patterns.length === 0) {
        carry = '';
        cb(null, text);
        return;
      }
      const scrubbed = scrubString(text, patterns);
      // Only emit what cannot still be the start of a secret.
      const safeEnd = Math.max(0, scrubbed.length - holdback);
      carry = scrubbed.slice(safeEnd);
      // A child waiting on a prompt ("Password:") never sends a newline:
      // release the tail after a short idle period rather than hanging the UI.
      if (carry && idleFlushMs > 0) {
        timer = setTimeout(() => {
          const out = scrubString(carry, patterns);
          carry = '';
          stream.push(out);
        }, idleFlushMs);
        timer.unref();
      }
      cb(null, scrubbed.slice(0, safeEnd));
    },
    flush(cb) {
      if (timer) clearTimeout(timer);
      cb(null, scrubString(carry, patterns));
      carry = '';
    },
  });
  return stream;
}
