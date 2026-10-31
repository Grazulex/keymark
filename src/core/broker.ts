import chalk from 'chalk';
import { audit } from './audit';
import { agentName, runningInAgent } from './paths';
import { type Policies, commandAllowed, describePolicy, getPolicy, loadPolicies } from './policy';
import { confirm } from './prompt';
import { collectRefs, resolveRefs } from './refs';
import { buildPatterns, scrubString } from './scrub';
import { KeymarkError, getSecrets } from './vault';

export interface BrokerRequest {
  /** Human-readable, unresolved command line (for policy matching, prompts, audit). */
  command: string;
  /** Strings that may contain references: argv, env templates, recipe body... */
  templates: string[];
  action: 'exec' | 'run' | 'env' | 'ssh';
  /** Secret paths needed in addition to the references found in templates. */
  extraSecrets?: string[];
}

export interface BrokerGrant {
  secrets: string[];
  values: Map<string, string>;
  resolve: (template: string) => string;
}

/**
 * The broker is the only place where secrets are decrypted for use.
 * It enforces policies, asks a human when required, and writes the audit trail.
 */
export async function broker(
  req: BrokerRequest,
  policies: Policies = loadPolicies()
): Promise<BrokerGrant> {
  const secrets = [...new Set([...collectRefs(req.templates), ...(req.extraSecrets ?? [])])];

  const deny = (reason: string, code = 2): never => {
    audit({ action: 'denied', secrets, command: req.command, reason });
    throw new KeymarkError(reason, code);
  };

  for (const path of secrets) {
    const policy = getPolicy(path, policies);
    if (policy.humanOnly && runningInAgent()) {
      deny(`Policy for "${path}" is human-only; refused for agent "${agentName()}".`);
    }
    if (!commandAllowed(policy, req.command)) {
      deny(
        `Policy for "${path}" does not allow this command.\n  command: ${req.command}\n  policy:  ${describePolicy(policy)}`
      );
    }
  }

  const needApproval = secrets.filter((p) => getPolicy(p, policies).approve);
  if (needApproval.length > 0) {
    const ok = await confirm(
      `${chalk.yellow('keymark')} ${agentName()} wants to use ${chalk.bold(needApproval.join(', '))}\n  ${chalk.dim(req.command)}\nAllow?`
    ).catch((e: KeymarkError) => {
      if (e.exitCode === 3) {
        deny(
          `Approval required for ${needApproval.join(', ')} but no terminal is attached. A human must run this command, or relax the policy with \`keymark policy <path> --no-approve\`.`,
          3
        );
      }
      throw e;
    });
    if (!ok) deny('Denied by user.', 2);
  }

  const values = await getSecrets(secrets);
  // The command line should only ever contain references, but if a value was
  // pasted in by mistake it must not end up in the audit log either.
  audit({
    action: req.action,
    secrets,
    command: scrubString(req.command, buildPatterns(values)),
  });
  return {
    secrets,
    values,
    resolve: (template) => resolveRefs(template, values),
  };
}
