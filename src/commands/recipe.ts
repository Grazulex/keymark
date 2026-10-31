import chalk from 'chalk';
import type { Command } from 'commander';
import { findProjectFile, loadProject, upsertRecipe } from '../core/project';
import { KeymarkError } from '../core/vault';

export function registerRecipeCommands(program: Command): void {
  const recipe = program.command('recipe').description('Manage recipes in .keymark.json');

  recipe
    .command('list', { isDefault: true })
    .description('List recipes of the current project')
    .action(() => {
      if (!findProjectFile()) {
        console.log(chalk.dim('No .keymark.json here. Create a recipe with `keymark recipe add`.'));
        return;
      }
      const { file, config } = loadProject();
      console.log(chalk.dim(file));
      for (const [name, r] of Object.entries(config.recipes)) {
        console.log(`${chalk.cyan(name)}${r.description ? chalk.dim(`  ${r.description}`) : ''}`);
        console.log(`  ${r.run}`);
        for (const [k, v] of Object.entries(r.env ?? {}))
          console.log(`  ${chalk.dim(`${k}=`)}${v}`);
      }
    });

  recipe
    .command('add <name>')
    .description('Add or replace a recipe')
    .requiredOption('--run <command>', 'shell command, may contain {{keymark:...}} references')
    .option(
      '-e, --env <VAR=path>',
      'inject a secret as env var (repeatable)',
      (v, acc: string[]) => [...acc, v],
      []
    )
    .option('-d, --description <text>', 'short description')
    .action((name: string, opts: { run: string; env: string[]; description?: string }) => {
      const env: Record<string, string> = {};
      for (const f of opts.env) {
        const i = f.indexOf('=');
        if (i <= 0) throw new KeymarkError(`--env expects VAR=secret/path, got "${f}".`);
        env[f.slice(0, i)] = f.slice(i + 1);
      }
      const file = upsertRecipe(name, {
        run: opts.run,
        ...(Object.keys(env).length ? { env } : {}),
        ...(opts.description ? { description: opts.description } : {}),
      });
      console.log(
        chalk.green(`✔ Recipe "${name}" saved in ${file}`),
        chalk.dim(`→ keymark run ${name}`)
      );
    });
}
