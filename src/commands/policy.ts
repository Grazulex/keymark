import chalk from 'chalk';
import type { Command } from 'commander';
import { describePolicy, getPolicy, removePolicy, setPolicy } from '../core/policy';
import { KeymarkError, hasSecret } from '../core/vault';

export function registerPolicyCommands(program: Command): void {
  program
    .command('policy <path>')
    .description('Show or change what a secret may be used for')
    .option(
      '--allow <glob>',
      'allowed command pattern (repeatable), e.g. "aws *"',
      (v, acc: string[]) => [...acc, v],
      []
    )
    .option('--allow-all', 'remove command restrictions')
    .option('--approve', 'require a human confirmation on every use')
    .option('--no-approve', 'do not require confirmation')
    .option('--human-only', 'refuse any use from an AI agent session')
    .option('--no-human-only', 'allow agents (default)')
    .option('--description <text>', 'short description shown in `keymark list`')
    .option('--reset', 'remove the policy entirely')
    .action(
      (
        path: string,
        opts: {
          allow: string[];
          allowAll?: boolean;
          approve?: boolean;
          humanOnly?: boolean;
          description?: string;
          reset?: boolean;
        }
      ) => {
        if (!hasSecret(path)) throw new KeymarkError(`Unknown secret "${path}".`);
        if (opts.reset) {
          removePolicy(path);
          console.log(chalk.green(`✔ Policy for ${path} reset to open.`));
          return;
        }
        const changing =
          opts.allow.length > 0 ||
          opts.allowAll ||
          opts.approve !== undefined ||
          opts.humanOnly !== undefined ||
          opts.description !== undefined;
        if (!changing) {
          console.log(`${chalk.cyan(path)}  ${describePolicy(getPolicy(path))}`);
          return;
        }
        // Only keys present in the patch are touched; an explicit undefined deletes the key.
        const patch: Record<string, unknown> = {};
        if (opts.allowAll) patch.allow = undefined;
        else if (opts.allow.length > 0) patch.allow = opts.allow;
        if (opts.approve !== undefined) patch.approve = opts.approve || undefined;
        if (opts.humanOnly !== undefined) patch.humanOnly = opts.humanOnly || undefined;
        if (opts.description !== undefined) patch.description = opts.description || undefined;
        const next = setPolicy(path, patch);
        console.log(chalk.green(`✔ ${path}`), describePolicy(next));
      }
    );
}
