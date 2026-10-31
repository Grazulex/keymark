/**
 * Decision logic for the Claude Code PreToolUse hook.
 * Pure functions: the CLI wrapper in commands/hook.ts handles stdin/stdout.
 *
 * Goal: stop the model from pulling raw secrets into its context
 * (reading .env, SSH keys, the KeyMark vault, dumping the environment...)
 * and nudge it towards `keymark exec` / `keymark run` instead.
 */

export interface HookInput {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface HookDecision {
  deny: boolean;
  reason?: string;
}

/** Paths whose content is a secret (not just a config). */
export const SENSITIVE_PATH_RE = new RegExp(
  [
    String.raw`(^|[\s/'"=:])\.env(\.[A-Za-z0-9_-]+)?(?=$|[\s'"|;&)])`, // .env, .env.local — not .env.example
    String.raw`\.ssh/(id_[A-Za-z0-9_-]+)(?!\.pub)(?=$|[\s'"|;&)])`, // private keys only
    String.raw`\.keymark/`,
    String.raw`\.netrc(?=$|[\s'"|;&)])`,
    String.raw`\.npmrc(?=$|[\s'"|;&)])`,
    String.raw`\.pypirc(?=$|[\s'"|;&)])`,
    String.raw`\.aws/credentials`,
    String.raw`\.docker/config\.json`,
    String.raw`\.kube/config`,
    String.raw`\.config/gh/hosts\.yml`,
    String.raw`\.git-credentials`,
    String.raw`\.(pem|p12|pfx|key)(?=$|[\s'"|;&)])`,
  ].join('|')
);

const EXAMPLE_FILE_RE = /\.env\.(example|sample|template|dist)\b/;

const READERS = new Set([
  'cat',
  'less',
  'more',
  'head',
  'tail',
  'bat',
  'sed',
  'awk',
  'grep',
  'rg',
  'ag',
  'strings',
  'xxd',
  'od',
  'hexdump',
  'base64',
  'cut',
  'sort',
  'uniq',
  'tr',
  'tee',
  'cp',
  'scp',
  'rsync',
  'source',
  '.',
  'vim',
  'vi',
  'nano',
  'code',
  'python',
  'python3',
  'node',
  'ruby',
  'perl',
  'php',
  'jq',
  'yq',
  'curl',
  'wget',
  'nc',
  'git',
]);

const ENV_DUMP_RE = /(^|[|;&]\s*)(env|printenv|export\s+-p|declare\s+-x|set)\s*(?=$|[|;&>])/;
const SECRET_VAR_RE =
  /\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASS|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)[A-Za-z_]*\}?/i;
const ECHO_VAR_RE = /(^|[|;&]\s*)(echo|printf|print)\s+.*\$/;
const KEYMARK_GET_RE = /(^|[|;&]\s*)keymark\s+(get|export)\b/;
const HINT =
  'Use `keymark exec -- <cmd>` or `keymark run <recipe>` so the secret is injected without entering the conversation.';

function words(command: string): string[] {
  return command
    .replace(/\\\n/g, ' ')
    .split(/[\s|;&()]+/)
    .map((w) => w.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

export function decideBash(command: string): HookDecision {
  const cmd = command.trim();
  if (!cmd) return { deny: false };

  if (KEYMARK_GET_RE.test(cmd)) {
    return {
      deny: true,
      reason: `\`keymark get\` prints a raw secret and is reserved for humans. ${HINT}`,
    };
  }

  // Reading or redirecting a sensitive file: cat .env, < .env, source ~/.ssh/..., python3 -c "open('.env')"
  const strippedExamples = cmd.replace(EXAMPLE_FILE_RE, 'EXAMPLE');
  if (SENSITIVE_PATH_RE.test(strippedExamples)) {
    const ws = words(strippedExamples);
    const usesReader = ws.some((w) => READERS.has(w.split('/').pop() ?? w));
    const redirectsIn = /<\s*\S*(\.env|\.ssh\/id_|\.keymark|\.netrc|\.npmrc|\.pem|\.key)/.test(
      strippedExamples
    );
    if (usesReader || redirectsIn) {
      return {
        deny: true,
        reason: `This command reads a file that holds secrets. ${HINT}`,
      };
    }
  }

  if (ENV_DUMP_RE.test(cmd)) {
    return {
      deny: true,
      reason:
        'Dumping the whole environment would expose every credential in it. Query one harmless variable at a time.',
    };
  }

  if (ECHO_VAR_RE.test(cmd) && SECRET_VAR_RE.test(cmd)) {
    return {
      deny: true,
      reason: `Printing a credential variable leaks it into the conversation. ${HINT}`,
    };
  }

  return { deny: false };
}

export function decideFileTool(toolName: string, filePath: string): HookDecision {
  if (EXAMPLE_FILE_RE.test(filePath)) return { deny: false };
  if (!SENSITIVE_PATH_RE.test(filePath)) return { deny: false };
  const verb = toolName === 'Read' ? 'Reading' : 'Writing';
  return {
    deny: true,
    reason: `${verb} ${filePath} is blocked: it holds secrets. ${HINT}`,
  };
}

export function decide(input: HookInput): HookDecision {
  const tool = input.tool_name ?? '';
  const ti = input.tool_input ?? {};
  if (tool === 'Bash') return decideBash(String(ti.command ?? ''));
  if (tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
    return decideFileTool(tool, String(ti.file_path ?? ''));
  }
  return { deny: false };
}

/** Serializes a decision in the format Claude Code expects on the hook's stdout. */
export function toHookOutput(decision: HookDecision): string | undefined {
  if (!decision.deny) return undefined;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[keymark] ${decision.reason}`,
    },
  });
}
