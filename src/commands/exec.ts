import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { broker } from '../core/broker';
import { execScrubbed } from '../core/exec';
import { loadProject, recipeEnvTemplates } from '../core/project';
import { KeymarkError, hasSecret } from '../core/vault';

/** Parses repeated `--env VAR=secret/path` flags into templates. */
function envFlagsToTemplates(flags: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of flags) {
    const i = f.indexOf('=');
    if (i <= 0) throw new KeymarkError(`--env expects VAR=secret/path, got "${f}".`);
    const name = f.slice(0, i);
    const target = f.slice(i + 1);
    out[name] = target.includes('{{') ? target : `{{keymark:${target}}}`;
  }
  return out;
}

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

async function runWithSecrets(params: {
  action: 'exec' | 'run' | 'env';
  argv: string[];
  shell: boolean;
  envTemplates: Record<string, string>;
  plainEnv?: Record<string, string>;
  /** Human-readable command used for policy matching and audit (defaults to argv joined). */
  commandLine?: string;
}): Promise<number> {
  const commandLine = params.commandLine ?? params.argv.join(' ');
  const grant = await broker({
    action: params.action,
    command: commandLine,
    templates: [...params.argv, ...Object.values(params.envTemplates)],
  });

  const env: NodeJS.ProcessEnv = { ...process.env, ...(params.plainEnv ?? {}) };
  for (const [k, tpl] of Object.entries(params.envTemplates)) env[k] = grant.resolve(tpl);
  env.KEYMARK_SECRETS = grant.secrets.join(',');

  return execScrubbed({
    argv: params.argv.map((a) => grant.resolve(a)),
    env,
    values: grant.values,
    shell: params.shell,
  });
}

export function registerExecCommands(program: Command): void {
  program
    .command('exec')
    .description('Run a command with {{keymark:path}} references resolved and output scrubbed')
    .option(
      '-e, --env <VAR=path>',
      'inject a secret as an environment variable (repeatable)',
      (v, acc: string[]) => [...acc, v],
      []
    )
    .option('-s, --shell', 'run through /bin/sh (allows pipes and redirections)')
    .argument('<command...>', 'command to run; put it after --')
    .passThroughOptions()
    .action(async (command: string[], opts: { env: string[]; shell?: boolean }) => {
      const code = await runWithSecrets({
        action: 'exec',
        argv: command,
        shell: Boolean(opts.shell),
        envTemplates: envFlagsToTemplates(opts.env),
      });
      process.exitCode = code;
    });

  program
    .command('run <recipe>')
    .description('Run a named recipe from .keymark.json')
    .argument('[args...]', 'extra arguments, available to the recipe as $1, $2… and "$@"')
    .passThroughOptions()
    .action(async (name: string, args: string[]) => {
      const { config } = loadProject();
      const recipe = config.recipes[name];
      if (!recipe) {
        const known = Object.keys(config.recipes);
        throw new KeymarkError(
          `Unknown recipe "${name}".${known.length ? ` Known: ${known.join(', ')}` : ''}`
        );
      }
      const code = await runWithSecrets({
        action: 'run',
        // sh -c '<script>' <$0> <$1> ... : arguments reach the recipe as positional parameters.
        argv: ['/bin/sh', '-c', recipe.run, `keymark run ${name}`, ...args],
        shell: false,
        commandLine: [recipe.run, ...args].join(' '),
        envTemplates: recipeEnvTemplates(recipe.env),
      });
      process.exitCode = code;
    });

  program
    .command('env')
    .description(
      'Load a .env file whose values may be {{keymark:...}} references, then run a command'
    )
    .option('-f, --file <path>', '.env file to load', '.env')
    .argument('<command...>', 'command to run; put it after --')
    .passThroughOptions()
    .action(async (command: string[], opts: { file: string }) => {
      let text: string;
      try {
        text = readFileSync(opts.file, 'utf-8');
      } catch {
        throw new KeymarkError(`Cannot read ${opts.file}.`);
      }
      const vars = parseDotenv(text);
      const envTemplates: Record<string, string> = {};
      const plainEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (v.includes('{{')) envTemplates[k] = v;
        else plainEnv[k] = v;
      }
      const code = await runWithSecrets({
        action: 'env',
        argv: command,
        shell: false,
        envTemplates,
        plainEnv,
      });
      process.exitCode = code;
    });

  program
    .command('ssh <host>')
    .description(
      'SSH with a private key from the vault, loaded into an ephemeral agent (never written to disk)'
    )
    .option('-k, --key <path>', 'secret path of the private key (default: ssh/<host>)')
    .argument('[args...]', 'extra ssh arguments / remote command')
    .passThroughOptions()
    .action(async (host: string, args: string[], opts: { key?: string }) => {
      const keyPath = opts.key ?? `ssh/${host}`;
      if (!hasSecret(keyPath)) {
        throw new KeymarkError(
          `No private key at "${keyPath}". Store one with: keymark set ${keyPath} --from-file ~/.ssh/id_ed25519`
        );
      }
      const grant = await broker({
        action: 'ssh',
        command: `ssh ${host} ${args.join(' ')}`.trim(),
        templates: [],
        extraSecrets: [keyPath],
      });
      const key = `${grant.values.get(keyPath)!.replace(/\n?$/, '')}\n`;

      const dir = mkdtempSync(join(tmpdir(), 'keymark-'));
      const sock = join(dir, 'agent.sock');
      const agent = spawn('ssh-agent', ['-D', '-a', sock], { stdio: 'ignore' });
      try {
        await waitForSocket(sock);
        const add = spawnSync('ssh-add', ['-'], {
          input: key,
          env: { ...process.env, SSH_AUTH_SOCK: sock },
          stdio: ['pipe', 'ignore', 'pipe'],
        });
        if (add.status !== 0) {
          throw new KeymarkError(
            `ssh-add failed: ${add.stderr?.toString().trim() || 'unknown error'}`
          );
        }
        const code = await execScrubbed({
          argv: ['ssh', '-o', 'IdentitiesOnly=yes', '-o', `IdentityAgent=${sock}`, host, ...args],
          env: { ...process.env, SSH_AUTH_SOCK: sock },
          values: grant.values,
          interactive: true,
        });
        process.exitCode = code;
      } finally {
        agent.kill('SIGTERM');
        rmSync(dir, { recursive: true, force: true });
      }
    });
}

async function waitForSocket(path: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - start > timeoutMs) {
      throw new KeymarkError('ssh-agent did not start (is OpenSSH installed?).');
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

export { parseDotenv, envFlagsToTemplates };
