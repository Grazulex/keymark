<div align="center">

# KeyMark

### Secrets broker for AI coding agents
**Your model uses the key. It never sees it.**

[![npm version](https://img.shields.io/npm/v/@grazulex/keymark.svg?style=flat-square&logo=npm&color=cb3837)](https://www.npmjs.com/package/@grazulex/keymark)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Documentation](https://img.shields.io/badge/📚-Documentation-10B981?style=flat-square)](https://keymark.tech)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](http://makeapullrequest.com)

**API keys, SSH keys, licenses: let Claude Code (or any agent) run the deploy, call the API, open the SSH session — without a single credential entering the conversation.**

[Quick Start](#-quick-start) • [How it works](#-how-it-works) • [Claude Code](#-claude-code-integration) • [Policies](#-policies) • [Team sharing](#-team-sharing)

</div>

---

## 🚀 The Problem

You ask your AI agent to "deploy to staging". To do that it needs `AWS_SECRET_ACCESS_KEY`. So it does `cat .env`. Now the key is:

- in the model's context, sent to the provider
- in the session transcript on your disk
- one autocomplete away from a commit, a log line or a generated README

The model never needed to *know* the key. It needed to *use* it.

```
❌ cat .env && aws s3 sync ./dist s3://my-bucket
✅ keymark exec -e AWS_SECRET_ACCESS_KEY=aws/staging/secret -- aws s3 sync ./dist s3://my-bucket
```

## ⚡ Quick Start

```bash
npm install -g @grazulex/keymark

keymark init                              # age identity + encrypted vault in ~/.keymark
keymark set stripe/live                   # value is typed on your terminal, never passed as an argument
keymark set ssh/prod-web --from-file ~/.ssh/id_ed25519

keymark install claude                    # Claude Code hook + rule, see below
```

Then let the agent work with **references** instead of values:

```bash
keymark exec -- curl -H "Authorization: Bearer {{keymark:stripe/live}}" https://api.stripe.com/v1/charges
keymark exec -e AWS_SECRET_ACCESS_KEY=aws/prod/secret -e AWS_ACCESS_KEY_ID=aws/prod/id -- aws s3 ls
keymark ssh prod-web "systemctl status app"
keymark run deploy                        # recipe stored in .keymark.json
```

## 🔍 How it works

```
 agent                       keymark                              child process
 ─────                       ───────                              ─────────────
 keymark exec -- curl        1. find {{keymark:…}} references
   -H "… {{keymark:x}}"      2. check policy (allow-list, human-only)
                             3. ask the human on /dev/tty if required
                             4. decrypt (age) ──────────────────►  curl -H "… sk_live_…"
                             5. pipe stdout/stderr through the           │
   "… [keymark:x] …"  ◄───────  scrubber (raw, base64, url, json) ◄──────┘
                             6. append to ~/.keymark/audit.jsonl
```

- **References, not values.** `{{keymark:aws/prod/token}}` in arguments, env vars, recipes or `.env` files. Resolution happens inside the spawned process only.
- **Scrubbed output.** If the child echoes a secret (debug logs, `env`, a stack trace), it comes back as `[keymark:aws/prod/token]`. Base64, URL-encoded and JSON-escaped variants are caught too, even across stream chunks.
- **Humans only for raw access.** `keymark get` refuses to print when stdout is not a terminal or when running inside an agent session.
- **No server.** The vault is a folder of [age](https://age-encryption.org)-encrypted files you can back up or sync with Git. Your identity never leaves your machine.
- **Audit trail.** Every use and every denial is logged with the calling agent (`claude-code`, `human`…), the secret names and the *unresolved* command.

## 🤖 Claude Code integration

```bash
keymark install claude            # ~/.claude  (or --project for ./.claude)
```

This does two things:

1. **`PreToolUse` hook** on `Bash`, `Read`, `Edit`, `Write`: denies `cat .env`, `cat ~/.ssh/id_*`, `env`, `echo $TOKEN`, `keymark get`, reading `~/.aws/credentials`, `*.pem`… and tells the model to use `keymark exec` instead. `.env.example` and `*.pub` stay readable.
2. **`rules/keymark.md`**: a short rule teaching Claude to reference secrets by name and to ask *you* to run `keymark set` when one is missing — never to ask for the value.

`keymark list` is safe for the agent: it shows names, descriptions and policies, never values.

## 🛡 Policies

```bash
keymark policy aws/prod/secret --allow "aws *" --allow "terraform *"   # only these commands
keymark policy stripe/live --approve                                   # confirm on your terminal each time
keymark policy ssh/bastion --human-only                                # never from an agent session
keymark policy aws/prod/secret --description "Prod deploy key"
keymark policy aws/prod/secret                                         # show
keymark policy aws/prod/secret --reset
```

When approval is required and no terminal is attached (typical for an agent), the request is **denied and logged** — the human has to run it.

## 📦 Recipes

Store the commands that need secrets in `.keymark.json` so the agent only has to type `keymark run <name>`:

```bash
keymark recipe add deploy \
  --run "aws s3 sync ./dist s3://my-bucket && aws cloudfront create-invalidation --distribution-id E123 --paths '/*'" \
  -e AWS_ACCESS_KEY_ID=aws/prod/id -e AWS_SECRET_ACCESS_KEY=aws/prod/secret \
  -d "Deploy the static site"

keymark run deploy
```

```json
{
  "recipes": {
    "deploy": {
      "run": "aws s3 sync ./dist s3://my-bucket",
      "env": { "AWS_ACCESS_KEY_ID": "aws/prod/id", "AWS_SECRET_ACCESS_KEY": "aws/prod/secret" },
      "description": "Deploy the static site"
    }
  }
}
```

`.keymark.json` is safe to commit: it contains names, not values.

## 🔑 SSH

```bash
keymark set ssh/prod-web --from-file ~/.ssh/id_ed25519
keymark ssh prod-web                      # interactive shell
keymark ssh prod-web -- "tail -f /var/log/app.log"
```

The key is loaded into an **ephemeral `ssh-agent`** over a private socket and removed when the session ends. It is never written to disk in clear.

## 🌱 `.env` files with references

Keep your `.env` committed-safe:

```dotenv
APP_ENV=local
STRIPE_KEY={{keymark:stripe/test}}
DATABASE_URL=postgres://app:{{keymark:db/local/password}}@localhost/app
```

```bash
keymark env -- npm run dev          # resolves references, injects everything, scrubs output
```

Works nicely with [EnvMark](https://envmark.tech): EnvMark versions the structure of your environments, KeyMark holds the sensitive values.

## 👥 Team sharing

Each person has an age identity. Add a teammate's public key and every secret is re-encrypted for them:

```bash
keymark recipients add age1teammate...
```

Sync `~/.keymark/vault/` with a private Git repository: it only contains ciphertext, recipient public keys and policies.

## 📜 Audit

```bash
keymark audit --since 1d
keymark audit --secret aws/prod/secret --json
```

```
2026-10-31 14:02:11  claude-code          exec             stripe/live
                     curl -H "Authorization: Bearer {{keymark:stripe/live}}" https://api.stripe.com/v1/charges
2026-10-31 14:05:40  claude-code          denied           aws/prod/secret
                     Approval required for aws/prod/secret but no terminal is attached.
```

## ⚠️ Threat model, honestly

KeyMark stops secrets from *leaking into the conversation* by accident or by sloppy habit. It makes exfiltration by a misbehaving agent much harder (policies, approvals, scrubbing, audit) but not impossible: a child process that receives a secret can always do something creative with it. For hostile code, run `keymark exec` inside a container with no outbound network, and keep `--approve` on anything that matters.

## 🧰 Commands

| Command | Description |
|---------|-------------|
| `keymark init [-r age1…]` | Create identity and vault |
| `keymark set <path> [--stdin\|--from-file f]` | Store a secret |
| `keymark get <path>` | Print a secret (humans, TTY only) |
| `keymark list [--json]` | List names and policies |
| `keymark rm <path>` | Delete a secret |
| `keymark exec [-e VAR=path] [-s] -- <cmd>` | Run with references resolved |
| `keymark run <recipe> [args]` | Run a recipe from `.keymark.json` |
| `keymark env [-f .env] -- <cmd>` | Load a `.env` with references |
| `keymark ssh <host> [-k path] [args]` | SSH with a vaulted key |
| `keymark policy <path> [...]` | Show / change a policy |
| `keymark recipe add\|list` | Manage recipes |
| `keymark recipients add\|list` | Manage who can decrypt |
| `keymark audit [--since d] [--secret p]` | Show the audit trail |
| `keymark install claude [--project]` | Install Claude Code hook + rule |

## 🧱 The *mark family

[Backmark](https://backmark.tech) · [Shipmark](https://shipmark.tech) · [Stackmark](https://stackmark.tech) · [Envmark](https://envmark.tech) · [Contextmark](https://contextmark.tech) · **Keymark**

## License

MIT © [Jean-Marc Strauven](https://github.com/Grazulex)
