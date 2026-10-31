import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolves KeyMark's home directory. Overridable with KEYMARK_HOME
 * (used by tests and by people who keep their vault elsewhere).
 */
export function keymarkHome(): string {
  return process.env.KEYMARK_HOME || join(homedir(), '.keymark');
}

export const paths = {
  home: (): string => keymarkHome(),
  identity: (): string => join(keymarkHome(), 'identity.txt'),
  vault: (): string => join(keymarkHome(), 'vault'),
  recipients: (): string => join(keymarkHome(), 'vault', 'recipients.txt'),
  secrets: (): string => join(keymarkHome(), 'vault', 'secrets'),
  policies: (): string => join(keymarkHome(), 'vault', 'policies.json'),
  audit: (): string => join(keymarkHome(), 'audit.jsonl'),
};

export const PROJECT_FILE = '.keymark.json';

/** True when running inside an AI coding agent session. */
export function runningInAgent(): boolean {
  return Boolean(process.env.CLAUDECODE || process.env.KEYMARK_AGENT);
}

export function agentName(): string {
  if (process.env.CLAUDECODE) return 'claude-code';
  if (process.env.KEYMARK_AGENT) return process.env.KEYMARK_AGENT;
  return 'human';
}
