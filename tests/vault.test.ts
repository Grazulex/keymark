import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { paths } from '../src/core/paths';
import {
  assertSecretPath,
  getSecret,
  hasSecret,
  initVault,
  listRecipients,
  listSecrets,
  removeSecret,
  setSecret,
} from '../src/core/vault';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'keymark-test-'));
  process.env.KEYMARK_HOME = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  Reflect.deleteProperty(process.env, 'KEYMARK_HOME');
});

describe('vault', () => {
  it('initializes an identity with mode 600 and one recipient', async () => {
    const { created, recipient } = await initVault();
    expect(created).toBe(true);
    expect(recipient).toMatch(/^age1/);
    expect(statSync(paths.identity()).mode & 0o777).toBe(0o600);
    expect(listRecipients()).toEqual([recipient]);
  });

  it('is idempotent', async () => {
    const first = await initVault();
    const second = await initVault();
    expect(second.created).toBe(false);
    expect(second.recipient).toBe(first.recipient);
  });

  it('round-trips a secret through age encryption', async () => {
    await initVault();
    await setSecret('aws/prod/token', 'AKIA-super-secret\nmultiline');
    expect(hasSecret('aws/prod/token')).toBe(true);
    expect(await getSecret('aws/prod/token')).toBe('AKIA-super-secret\nmultiline');
    expect(listSecrets()).toEqual(['aws/prod/token']);
    removeSecret('aws/prod/token');
    expect(listSecrets()).toEqual([]);
  });

  it('rejects path traversal and junk names', () => {
    expect(() => assertSecretPath('../etc/passwd')).toThrow();
    expect(() => assertSecretPath('a//b')).toThrow();
    expect(() => assertSecretPath('/abs')).toThrow();
    expect(() => assertSecretPath('ok/with.dots_and-dashes')).not.toThrow();
  });

  it('fails clearly on unknown secret', async () => {
    await initVault();
    await expect(getSecret('nope')).rejects.toThrow(/Unknown secret/);
  });
});
