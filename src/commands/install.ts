import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { decide, toHookOutput } from '../hooks/claude';

const HOOK_COMMAND = 'keymark hook pre-tool-use';
const HOOK_MATCHER = 'Bash|Read|Edit|Write|MultiEdit';

export const CLAUDE_RULE = `# KeyMark — secrets are used, never read

This machine uses KeyMark (https://keymark.tech) to broker secrets.

- Never read, print or copy credentials: no \`cat .env\`, no \`cat ~/.ssh/id_*\`, no \`echo $TOKEN\`, no \`env\`.
- To run something that needs a secret, reference it and let KeyMark inject it:
  - \`keymark exec -- curl -H "Authorization: Bearer {{keymark:stripe/live}}" https://api.stripe.com/v1/charges\`
  - \`keymark exec -e AWS_SECRET_ACCESS_KEY=aws/prod/secret -- aws s3 ls\`
  - \`keymark run deploy\` (recipes live in \`.keymark.json\`)
  - \`keymark ssh prod-web\`
- \`keymark list\` shows the names of available secrets. Values are never shown; output is scrubbed.
- If a secret you need does not exist, ask the human to run \`keymark set <path>\`. Do not ask for the value.
`;

interface HooksSettings {
  hooks?: Record<
    string,
    Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
  >;
  [key: string]: unknown;
}

export function mergeHook(settings: HooksSettings): { settings: HooksSettings; added: boolean } {
  settings.hooks ??= {};
  settings.hooks.PreToolUse ??= [];
  const present = settings.hooks.PreToolUse.some((entry) =>
    entry.hooks.some((h) => h.command === HOOK_COMMAND)
  );
  if (present) return { settings, added: false };
  settings.hooks.PreToolUse.push({
    matcher: HOOK_MATCHER,
    hooks: [{ type: 'command', command: HOOK_COMMAND }],
  });
  return { settings, added: true };
}

export function registerInstallCommands(program: Command): void {
  program
    .command('install <target>')
    .description('Integrate with an agent. Targets: claude (Claude Code hooks + rule)')
    .option('--project', 'install in ./.claude instead of ~/.claude')
    .action((target: string, opts: { project?: boolean }) => {
      if (target !== 'claude') {
        console.error(chalk.red(`Unknown target "${target}". Available: claude`));
        process.exitCode = 1;
        return;
      }
      const base = opts.project ? join(process.cwd(), '.claude') : join(homedir(), '.claude');
      mkdirSync(join(base, 'rules'), { recursive: true });

      const settingsFile = join(base, 'settings.json');
      let settings: HooksSettings = {};
      if (existsSync(settingsFile)) {
        try {
          settings = JSON.parse(readFileSync(settingsFile, 'utf-8')) as HooksSettings;
        } catch (e) {
          console.error(chalk.red(`Cannot parse ${settingsFile}: ${(e as Error).message}`));
          process.exitCode = 1;
          return;
        }
      }
      const { added } = mergeHook(settings);
      writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
      console.log(
        added
          ? chalk.green(`✔ PreToolUse hook added to ${settingsFile}`)
          : chalk.dim(`Hook already present in ${settingsFile}`)
      );

      const ruleFile = join(base, 'rules', 'keymark.md');
      writeFileSync(ruleFile, CLAUDE_RULE);
      console.log(chalk.green(`✔ Rule written to ${ruleFile}`));
      console.log(chalk.dim('\nRestart Claude Code for the hook to take effect.'));
    });

  program
    .command('hook <event>', { hidden: true })
    .description('Internal: hook handler invoked by the agent (reads JSON on stdin)')
    .action(async (event: string) => {
      if (event !== 'pre-tool-use') return;
      const chunks: Buffer[] = [];
      for await (const c of process.stdin) chunks.push(c as Buffer);
      let input: unknown;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
      } catch {
        return; // malformed input: never block the agent on our own bug
      }
      const out = toHookOutput(decide(input as Parameters<typeof decide>[0]));
      if (out) process.stdout.write(`${out}\n`);
    });
}
