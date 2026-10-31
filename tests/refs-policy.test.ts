import { describe, expect, it } from 'vitest';
import { sinceToDate } from '../src/core/audit';
import { commandAllowed, globToRegExp } from '../src/core/policy';
import { collectRefs, findRefs, hasRefs, resolveRefs } from '../src/core/refs';

describe('refs', () => {
  it('finds and dedupes references', () => {
    expect(findRefs('a {{keymark:x/y}} b {{ keymark:x/y }} {{keymark:z}}')).toEqual(['x/y', 'z']);
    expect(collectRefs(['{{keymark:a}}', 'none', '{{keymark:b}}'])).toEqual(['a', 'b']);
    expect(hasRefs('{{keymark:a}}')).toBe(true);
    expect(hasRefs('{{other:a}}')).toBe(false);
  });

  it('resolves references and throws on unknown ones', () => {
    const values = new Map([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(resolveRefs('{{keymark:a}}-{{keymark:b}}', values)).toBe('1-2');
    expect(() => resolveRefs('{{keymark:c}}', values)).toThrow(/Unresolved/);
  });
});

describe('policy', () => {
  it('matches globs against the full command line', () => {
    expect(globToRegExp('aws *').test('aws s3 ls')).toBe(true);
    expect(globToRegExp('aws *').test('curl aws')).toBe(false);
    expect(globToRegExp('curl *api.stripe.com*').test('curl -s https://api.stripe.com/v1')).toBe(
      true
    );
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('defaults to allow-all when no patterns are set', () => {
    expect(commandAllowed({}, 'anything')).toBe(true);
    expect(commandAllowed({ allow: [] }, 'anything')).toBe(true);
    expect(commandAllowed({ allow: ['aws *'] }, 'terraform apply')).toBe(false);
    expect(commandAllowed({ allow: ['aws *', 'terraform *'] }, 'terraform apply')).toBe(true);
  });
});

describe('audit durations', () => {
  it('parses durations', () => {
    const now = Date.UTC(2026, 0, 2);
    expect(sinceToDate('1d', now).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(sinceToDate('30m', now).getTime()).toBe(now - 30 * 60_000);
    expect(() => sinceToDate('soon')).toThrow();
  });
});
