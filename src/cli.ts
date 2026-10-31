#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { registerAuditCommand } from './commands/audit';
import { registerExecCommands } from './commands/exec';
import { registerInstallCommands } from './commands/install';
import { registerPolicyCommands } from './commands/policy';
import { registerRecipeCommands } from './commands/recipe';
import { registerVaultCommands } from './commands/vault';
import { KeymarkError } from './core/vault';

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as {
      version: string;
    };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const program = new Command()
  .name('keymark')
  .description(
    'Secrets broker for AI coding agents: your model uses keys without ever seeing them.'
  )
  .version(version())
  .showHelpAfterError()
  .enablePositionalOptions();

registerVaultCommands(program);
registerPolicyCommands(program);
registerExecCommands(program);
registerRecipeCommands(program);
registerAuditCommand(program);
registerInstallCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof KeymarkError) {
    console.error(chalk.red(`✖ ${err.message}`));
    process.exit(err.exitCode);
  }
  console.error(chalk.red(`✖ ${(err as Error).message ?? String(err)}`));
  process.exit(1);
});
