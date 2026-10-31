import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { Decrypter, Encrypter, generateIdentity, identityToRecipient } from 'age-encryption';
import { paths } from './paths';

export const SECRET_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class KeymarkError extends Error {
  constructor(
    message: string,
    public readonly exitCode = 1
  ) {
    super(message);
    this.name = 'KeymarkError';
  }
}

export function assertSecretPath(path: string): void {
  if (!SECRET_PATH_RE.test(path) || path.includes('..')) {
    throw new KeymarkError(
      `Invalid secret path "${path}". Use segments like "aws/prod/token" (letters, digits, . _ -).`
    );
  }
}

function secretFile(path: string): string {
  assertSecretPath(path);
  return join(paths.secrets(), `${path}.age`);
}

export function isInitialized(): boolean {
  return existsSync(paths.identity()) && existsSync(paths.recipients());
}

export function requireInitialized(): void {
  if (!isInitialized()) {
    throw new KeymarkError('KeyMark is not initialized. Run `keymark init` first.');
  }
}

/** Creates the home dir, an age identity and an empty vault. Idempotent. */
export async function initVault(extraRecipients: string[] = []): Promise<{
  created: boolean;
  recipient: string;
}> {
  mkdirSync(paths.home(), { recursive: true, mode: 0o700 });
  chmodSync(paths.home(), 0o700);
  mkdirSync(paths.secrets(), { recursive: true });

  let created = false;
  if (!existsSync(paths.identity())) {
    const identity = await generateIdentity();
    writeFileSync(paths.identity(), `${identity}\n`, { mode: 0o600 });
    chmodSync(paths.identity(), 0o600);
    created = true;
  }
  const recipient = await identityToRecipient(loadIdentity());

  const recipients = new Set(existsSync(paths.recipients()) ? listRecipients() : []);
  recipients.add(recipient);
  for (const r of extraRecipients) recipients.add(r.trim());
  writeFileSync(paths.recipients(), `${[...recipients].join('\n')}\n`, { mode: 0o600 });

  if (!existsSync(paths.policies())) {
    writeFileSync(paths.policies(), '{}\n', { mode: 0o600 });
  }
  return { created, recipient };
}

export function loadIdentity(): string {
  if (!existsSync(paths.identity())) {
    throw new KeymarkError('No identity found. Run `keymark init` first.');
  }
  const mode = statSync(paths.identity()).mode & 0o777;
  if (mode & 0o077) {
    throw new KeymarkError(
      `Refusing to use ${paths.identity()}: permissions are too open (${mode.toString(8)}). Run chmod 600 on it.`
    );
  }
  const line = readFileSync(paths.identity(), 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('AGE-SECRET-KEY-'));
  if (!line) throw new KeymarkError(`No AGE-SECRET-KEY found in ${paths.identity()}.`);
  return line;
}

export function listRecipients(): string[] {
  if (!existsSync(paths.recipients())) return [];
  return readFileSync(paths.recipients(), 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export async function addRecipient(recipient: string): Promise<void> {
  requireInitialized();
  const r = recipient.trim();
  if (!/^age1[a-z0-9]+$/.test(r)) {
    throw new KeymarkError(`"${recipient}" does not look like an age recipient (age1...).`);
  }
  const current = listRecipients();
  if (current.includes(r)) return;
  writeFileSync(paths.recipients(), `${[...current, r].join('\n')}\n`, { mode: 0o600 });
  // Re-encrypt everything so the new recipient can read existing secrets.
  for (const path of listSecrets()) {
    await setSecret(path, await getSecret(path));
  }
}

async function encrypt(plaintext: string): Promise<Uint8Array> {
  const e = new Encrypter();
  const recipients = listRecipients();
  if (recipients.length === 0) throw new KeymarkError('No recipients configured.');
  for (const r of recipients) e.addRecipient(r);
  return e.encrypt(plaintext);
}

async function decrypt(ciphertext: Uint8Array): Promise<string> {
  const d = new Decrypter();
  d.addIdentity(loadIdentity());
  try {
    return await d.decrypt(ciphertext, 'text');
  } catch {
    throw new KeymarkError('Decryption failed: this secret was not encrypted for your identity.');
  }
}

export async function setSecret(path: string, value: string): Promise<void> {
  requireInitialized();
  const file = secretFile(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await encrypt(value), { mode: 0o600 });
}

export function hasSecret(path: string): boolean {
  return existsSync(secretFile(path));
}

export async function getSecret(path: string): Promise<string> {
  requireInitialized();
  const file = secretFile(path);
  if (!existsSync(file)) throw new KeymarkError(`Unknown secret "${path}".`);
  return decrypt(new Uint8Array(readFileSync(file)));
}

export function removeSecret(path: string): void {
  requireInitialized();
  const file = secretFile(path);
  if (!existsSync(file)) throw new KeymarkError(`Unknown secret "${path}".`);
  rmSync(file);
}

export function listSecrets(): string[] {
  const root = paths.secrets();
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.age')) {
        out.push(
          relative(root, full)
            .split(sep)
            .join('/')
            .replace(/\.age$/, '')
        );
      }
    }
  };
  walk(root);
  return out.sort();
}

/** Resolves several secrets at once, failing fast on the first unknown one. */
export async function getSecrets(secretPaths: Iterable<string>): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  for (const p of secretPaths) values.set(p, await getSecret(p));
  return values;
}
