import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import type { Command } from 'commander';
import { audit } from '../core/audit';
import { paths, runningInAgent } from '../core/paths';
import { describePolicy, getPolicy, loadPolicies, removePolicy } from '../core/policy';
import { promptHidden } from '../core/prompt';
import {
  KeymarkError,
  addRecipient,
  getSecret,
  hasSecret,
  initVault,
  isInitialized,
  listRecipients,
  listSecrets,
  removeSecret,
  setSecret,
} from '../core/vault';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

export function registerVaultCommands(program: Command): void {
  program
    .command('init')
    .description('Create your age identity and an empty vault in ~/.keymark')
    .option(
      '-r, --recipient <age1...>',
      'extra recipient (teammate public key)',
      (v, acc: string[]) => [...acc, v],
      []
    )
    .action(async (opts: { recipient: string[] }) => {
      const already = isInitialized();
      const { created, recipient } = await initVault(opts.recipient);
      console.log(
        already ? chalk.dim('Vault already initialized.') : chalk.green('✔ Vault initialized.')
      );
      if (created)
        console.log(
          `  identity   ${paths.identity()} ${chalk.dim('(mode 600 — back it up, it is the only way to read your vault)')}`
        );
      console.log(`  vault      ${paths.vault()}`);
      console.log(`  recipient  ${chalk.cyan(recipient)}`);
      console.log(chalk.dim('\nNext: keymark set <path>   •   keymark install claude'));
    });

  program
    .command('set <path>')
    .description('Store a secret (value is prompted on the terminal, never passed as an argument)')
    .option('--stdin', 'read the value from stdin')
    .option('--from-file <file>', 'read the value from a file (e.g. an SSH private key)')
    .option('--force', 'overwrite without asking')
    .action(async (path: string, opts: { stdin?: boolean; fromFile?: string; force?: boolean }) => {
      if (hasSecret(path) && !opts.force) {
        throw new KeymarkError(`"${path}" already exists. Use --force to overwrite.`);
      }
      let value: string;
      if (opts.fromFile) value = readFileSync(opts.fromFile, 'utf-8');
      else if (opts.stdin) value = await readStdin();
      else value = await promptHidden(`Value for ${chalk.cyan(path)}: `);
      if (opts.stdin || opts.fromFile) value = value.replace(/\r?\n$/, '');
      if (!value) throw new KeymarkError('Empty value, nothing stored.');
      if (value.length < 8)
        console.error(chalk.yellow('⚠ Very short value: output scrubbing is less effective.'));
      await setSecret(path, value);
      audit({ action: 'set', secrets: [path] });
      console.log(chalk.green(`✔ Stored ${path}`), chalk.dim(`→ use it as {{keymark:${path}}}`));
    });

  program
    .command('get <path>')
    .description(
      'Print a secret (humans only: refused when stdout is not a terminal or inside an agent)'
    )
    .action(async (path: string) => {
      if (runningInAgent() || !process.stdout.isTTY) {
        audit({
          action: 'denied',
          secrets: [path],
          command: `keymark get ${path}`,
          reason: 'non-interactive get',
        });
        throw new KeymarkError(
          'Refusing to print a secret to a non-interactive stdout. Use `keymark exec -- ...` instead.',
          2
        );
      }
      const value = await getSecret(path);
      audit({ action: 'get', secrets: [path] });
      process.stdout.write(`${value}\n`);
    });

  program
    .command('list')
    .alias('ls')
    .description('List secret names and their policies (never values)')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      const policies = loadPolicies();
      const secrets = listSecrets();
      if (opts.json) {
        console.log(
          JSON.stringify(
            secrets.map((p) => ({ path: p, ...getPolicy(p, policies) })),
            null,
            2
          )
        );
        return;
      }
      if (secrets.length === 0) {
        console.log(chalk.dim('No secrets yet. Add one with `keymark set <path>`.'));
        return;
      }
      const width = Math.max(...secrets.map((s) => s.length));
      for (const p of secrets) {
        const policy = getPolicy(p, policies);
        const desc = policy.description ? chalk.dim(`  ${policy.description}`) : '';
        console.log(`${chalk.cyan(p.padEnd(width))}  ${describePolicy(policy)}${desc}`);
      }
    });

  program
    .command('rm <path>')
    .alias('remove')
    .description('Delete a secret and its policy')
    .action((path: string) => {
      removeSecret(path);
      removePolicy(path);
      audit({ action: 'rm', secrets: [path] });
      console.log(chalk.green(`✔ Removed ${path}`));
    });

  const recipients = program.command('recipients').description('Manage who can decrypt the vault');
  recipients
    .command('list', { isDefault: true })
    .description('List recipients')
    .action(() => {
      for (const r of listRecipients()) console.log(r);
    });
  recipients
    .command('add <age1...>')
    .description('Add a teammate public key and re-encrypt all secrets for them')
    .action(async (recipient: string) => {
      await addRecipient(recipient);
      console.log(
        chalk.green(`✔ Added ${recipient} and re-encrypted ${listSecrets().length} secret(s).`)
      );
    });
}
