import chalk from 'chalk';
import type { Command } from 'commander';
import { readAudit, sinceToDate } from '../core/audit';

export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Show who used which secret, when, and for what command')
    .option('--since <duration>', 'only entries newer than e.g. 30m, 2h, 1d, 1w')
    .option('-n, --limit <n>', 'max entries (default 50)', '50')
    .option('--secret <path>', 'filter by secret path')
    .option('--json', 'machine-readable output')
    .action((opts: { since?: string; limit: string; secret?: string; json?: boolean }) => {
      let entries = readAudit();
      if (opts.since) {
        const from = sinceToDate(opts.since).toISOString();
        entries = entries.filter((e) => e.ts >= from);
      }
      if (opts.secret) entries = entries.filter((e) => e.secrets.includes(opts.secret!));
      entries = entries.slice(-Number(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log(chalk.dim('No audit entries.'));
        return;
      }
      for (const e of entries) {
        const when = e.ts.replace('T', ' ').slice(0, 19);
        const who = e.agent === 'human' ? chalk.green(e.agent) : chalk.magenta(e.agent);
        const action = e.action === 'denied' ? chalk.red(e.action) : chalk.cyan(e.action);
        const secrets = e.secrets.join(', ');
        console.log(`${chalk.dim(when)}  ${who.padEnd(20)} ${action.padEnd(16)} ${secrets}`);
        if (e.command) console.log(`${' '.repeat(21)}${chalk.dim(e.command)}`);
        if (e.reason) console.log(`${' '.repeat(21)}${chalk.red(e.reason.split('\n')[0])}`);
      }
    });
}
