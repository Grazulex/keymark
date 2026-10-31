import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { agentName, paths } from './paths';

export interface AuditEntry {
  ts: string;
  action: 'exec' | 'run' | 'env' | 'ssh' | 'get' | 'set' | 'rm' | 'denied';
  secrets: string[];
  /** Unresolved command line (references, never values). Truncated. */
  command?: string;
  cwd: string;
  agent: string;
  exit?: number | null;
  reason?: string;
}

export function audit(entry: Omit<AuditEntry, 'ts' | 'cwd' | 'agent'>): void {
  const full: AuditEntry = {
    ts: new Date().toISOString(),
    cwd: process.cwd(),
    agent: agentName(),
    ...entry,
    command: entry.command?.slice(0, 500),
  };
  const file = paths.audit();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(full)}\n`, { mode: 0o600 });
}

export function readAudit(): AuditEntry[] {
  const file = paths.audit();
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditEntry);
}

/** Parses "1h", "2d", "30m", "1w" into a Date in the past. */
export function sinceToDate(since: string, now = Date.now()): Date {
  const m = /^(\d+)([mhdw])$/.exec(since.trim());
  if (!m) throw new Error(`Invalid duration "${since}" (expected e.g. 30m, 2h, 1d, 1w).`);
  const n = Number(m[1]);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]]!;
  return new Date(now - n * unit);
}
