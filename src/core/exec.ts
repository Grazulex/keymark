import { type SpawnOptions, spawn } from 'node:child_process';
import { type ScrubPattern, buildPatterns, createScrubber } from './scrub';

export interface ExecOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  /** Values that must be scrubbed from the child's output. */
  values: Map<string, string>;
  shell?: boolean;
  cwd?: string;
  /** Inherit stdio directly (interactive tools like ssh). Output is NOT scrubbed. */
  interactive?: boolean;
}

/**
 * Spawns the child with resolved secrets and pipes its stdout/stderr through
 * the scrubber so a value that gets echoed never reaches the caller.
 * Returns the child's exit code.
 */
export function execScrubbed(opts: ExecOptions): Promise<number> {
  const [cmd, ...args] = opts.argv;
  const patterns: ScrubPattern[] = buildPatterns(opts.values);

  const spawnOpts: SpawnOptions = {
    env: opts.env,
    cwd: opts.cwd,
    shell: opts.shell ? '/bin/sh' : false,
    stdio: opts.interactive ? 'inherit' : ['inherit', 'pipe', 'pipe'],
  };

  return new Promise<number>((resolve, reject) => {
    const child = opts.shell ? spawn(opts.argv.join(' '), spawnOpts) : spawn(cmd, args, spawnOpts);

    if (!opts.interactive) {
      child.stdout!.pipe(createScrubber(patterns)).pipe(process.stdout);
      child.stderr!.pipe(createScrubber(patterns)).pipe(process.stderr);
    }

    const forward = (signal: NodeJS.Signals) => () => {
      if (!child.killed) child.kill(signal);
    };
    const onInt = forward('SIGINT');
    const onTerm = forward('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);

    child.on('error', (err) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      reject(err);
    });
    child.on('close', (code, signal) => {
      process.off('SIGINT', onInt);
      process.off('SIGTERM', onTerm);
      // Give the scrubber a tick to flush its holdback before we exit.
      setTimeout(() => resolve(code ?? (signal ? 128 + 1 : 1)), 60);
    });
  });
}
