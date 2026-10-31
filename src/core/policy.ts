import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { paths } from './paths';
import { KeymarkError, assertSecretPath } from './vault';

export interface Policy {
  /** Human description, shown in `keymark list`. Never the value. */
  description?: string;
  /** Glob patterns the (unresolved) command line must match. Default: ["*"]. */
  allow?: string[];
  /** Ask a human on /dev/tty before each use. Default: false. */
  approve?: boolean;
  /** Refuse any use from an AI agent session. Default: false. */
  humanOnly?: boolean;
}

export type Policies = Record<string, Policy>;

export function loadPolicies(): Policies {
  const file = paths.policies();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Policies;
  } catch (e) {
    throw new KeymarkError(`Cannot parse ${file}: ${(e as Error).message}`);
  }
}

export function savePolicies(policies: Policies): void {
  writeFileSync(paths.policies(), `${JSON.stringify(policies, null, 2)}\n`, { mode: 0o600 });
}

export function getPolicy(path: string, policies: Policies = loadPolicies()): Policy {
  return policies[path] ?? {};
}

export function setPolicy(path: string, patch: Policy): Policy {
  assertSecretPath(path);
  const policies = loadPolicies();
  const next: Policy = { ...(policies[path] ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof Policy)[]) {
    if (next[k] === undefined) delete next[k];
  }
  policies[path] = next;
  savePolicies(policies);
  return next;
}

export function removePolicy(path: string): void {
  const policies = loadPolicies();
  delete policies[path];
  savePolicies(policies);
}

/** Minimal glob: `*` matches anything, `?` one char, everything else literal. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('')
    .map((c) => {
      if (c === '*') return '.*';
      if (c === '?') return '.';
      return c.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${escaped}$`, 's');
}

export function commandAllowed(policy: Policy, command: string): boolean {
  const patterns = policy.allow && policy.allow.length > 0 ? policy.allow : ['*'];
  return patterns.some((p) => globToRegExp(p).test(command));
}

export function describePolicy(policy: Policy): string {
  const parts: string[] = [];
  if (policy.humanOnly) parts.push('human-only');
  if (policy.approve) parts.push('approval');
  if (policy.allow && policy.allow.length > 0) parts.push(`allow: ${policy.allow.join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : 'open';
}
