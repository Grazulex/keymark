import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { buildPatterns, createScrubber, scrubString } from '../src/core/scrub';

const values = new Map([
  ['stripe/live', 'sk_live_abcdef123456'],
  ['tiny', 'ab'],
]);

async function pipe(chunks: string[], idle = 0): Promise<string> {
  const scrubber = createScrubber(buildPatterns(values), idle);
  const out: Buffer[] = [];
  scrubber.on('data', (c: Buffer) => out.push(c));
  await new Promise<void>((resolve, reject) => {
    scrubber.on('end', resolve);
    scrubber.on('error', reject);
    Readable.from(chunks.map((c) => Buffer.from(c))).pipe(scrubber);
  });
  return Buffer.concat(out).toString('utf-8');
}

describe('scrubber', () => {
  it('replaces raw values with placeholders', () => {
    const p = buildPatterns(values);
    expect(scrubString('token=sk_live_abcdef123456 ok', p)).toBe('token=[keymark:stripe/live] ok');
  });

  it('also catches base64, url-encoded and JSON-escaped forms', () => {
    const p = buildPatterns(new Map([['k', 'p@ss word/"x']]));
    expect(scrubString(Buffer.from('p@ss word/"x').toString('base64'), p)).toBe('[keymark:k]');
    expect(scrubString(encodeURIComponent('p@ss word/"x'), p)).toBe('[keymark:k]');
    expect(scrubString(JSON.stringify({ a: 'p@ss word/"x' }), p)).toBe('{"a":"[keymark:k]"}');
  });

  it('ignores values too short to scrub safely', () => {
    const p = buildPatterns(values);
    expect(scrubString('abab', p)).toBe('abab');
  });

  it('scrubs a value split across chunks', async () => {
    const out = await pipe(['Authorization: sk_live_ab', 'cdef1234', '56\ndone\n']);
    expect(out).toBe('Authorization: [keymark:stripe/live]\ndone\n');
  });

  it('passes clean output through untouched', async () => {
    expect(await pipe(['hello ', 'world\n'])).toBe('hello world\n');
  });

  it('flushes the holdback when the stream goes idle', async () => {
    const scrubber = createScrubber(buildPatterns(values), 20);
    const out: Buffer[] = [];
    scrubber.on('data', (c: Buffer) => out.push(c));
    scrubber.write('Password: ');
    await new Promise((r) => setTimeout(r, 60));
    expect(Buffer.concat(out).toString()).toBe('Password: ');
    scrubber.end();
  });
});
