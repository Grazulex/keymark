import { describe, expect, it } from 'vitest';
import { mergeHook } from '../src/commands/install';
import { decide, decideBash, decideFileTool, toHookOutput } from '../src/hooks/claude';

const denied = (cmd: string) => decideBash(cmd).deny;

describe('Claude Code hook — Bash', () => {
  it('blocks reading secret files', () => {
    expect(denied('cat .env')).toBe(true);
    expect(denied('cat ./.env.local')).toBe(true);
    expect(denied('head -n 5 ~/.ssh/id_ed25519')).toBe(true);
    expect(denied('cat ~/.keymark/identity.txt')).toBe(true);
    expect(denied('grep TOKEN .env')).toBe(true);
    expect(denied('source .env && npm start')).toBe(true);
    expect(denied('python3 -c "print(open(\'.env\').read())"')).toBe(true);
    expect(denied('cat ~/.aws/credentials')).toBe(true);
    expect(denied('cat server.pem')).toBe(true);
    expect(denied('git add .env')).toBe(true);
  });

  it('allows harmless commands that mention similar names', () => {
    expect(denied('cat .env.example')).toBe(false);
    expect(denied('cp .env.example .env.local.example')).toBe(false);
    expect(denied('ls -la ~/.ssh')).toBe(false);
    expect(denied('cat ~/.ssh/id_ed25519.pub')).toBe(false);
    expect(denied('npm run dev')).toBe(false);
    expect(denied('echo "set -e" > script.sh')).toBe(false);
    expect(denied('ls .env')).toBe(false);
    expect(denied('test -f .env && echo present')).toBe(false);
    expect(denied('keymark list')).toBe(false);
    expect(denied('keymark exec -- curl -H "Bearer {{keymark:stripe/live}}" https://x')).toBe(
      false
    );
  });

  it('blocks environment dumps and secret echoes', () => {
    expect(denied('env')).toBe(true);
    expect(denied('printenv')).toBe(true);
    expect(denied('env | grep AWS')).toBe(true);
    expect(denied('echo $STRIPE_SECRET_KEY')).toBe(true);
    expect(denied('echo "${GITHUB_TOKEN}"')).toBe(true);
    expect(denied('echo $HOME')).toBe(false);
    expect(denied('env FOO=bar npm test')).toBe(false);
    expect(denied('set -euo pipefail; make')).toBe(false);
  });

  it('blocks keymark get', () => {
    expect(denied('keymark get aws/prod/token')).toBe(true);
    expect(denied('echo hi; keymark get x')).toBe(true);
  });
});

describe('Claude Code hook — file tools', () => {
  it('blocks Read/Edit/Write on secret files', () => {
    expect(decideFileTool('Read', '/home/me/app/.env').deny).toBe(true);
    expect(decideFileTool('Read', '/home/me/.ssh/id_rsa').deny).toBe(true);
    expect(decideFileTool('Write', '/home/me/.keymark/vault/policies.json').deny).toBe(true);
    expect(decideFileTool('Read', '/home/me/app/.env.example').deny).toBe(false);
    expect(decideFileTool('Read', '/home/me/app/src/env.ts').deny).toBe(false);
    expect(decideFileTool('Read', '/home/me/.ssh/id_rsa.pub').deny).toBe(false);
  });

  it('dispatches on tool name and serializes a deny', () => {
    const d = decide({ tool_name: 'Bash', tool_input: { command: 'cat .env' } });
    const out = JSON.parse(toHookOutput(d)!);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/keymark exec/);
    expect(
      toHookOutput(decide({ tool_name: 'Bash', tool_input: { command: 'ls' } }))
    ).toBeUndefined();
    expect(decide({ tool_name: 'Glob', tool_input: {} }).deny).toBe(false);
  });
});

describe('settings merge', () => {
  it('adds the hook once and preserves other settings', () => {
    const first = mergeHook({ permissions: { allow: ['Bash(ls:*)'] } });
    expect(first.added).toBe(true);
    expect(first.settings.permissions).toEqual({ allow: ['Bash(ls:*)'] });
    const second = mergeHook(first.settings);
    expect(second.added).toBe(false);
    expect(second.settings.hooks!.PreToolUse).toHaveLength(1);
  });
});
