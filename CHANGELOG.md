# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Features

- `keymark init`: age identity + local encrypted vault in `~/.keymark`
- `keymark set/get/list/rm`: store secrets; values are never accepted as CLI arguments and never printed to a non-interactive stdout
- `keymark exec`, `keymark run`, `keymark env`: resolve `{{keymark:path}}` references inside the child process only, with output scrubbing (raw, base64, URL-encoded and JSON-escaped forms)
- `keymark ssh`: private key loaded into an ephemeral `ssh-agent`, never written to disk
- `keymark policy`: per-secret command allow-list, human approval on `/dev/tty`, human-only mode
- `keymark audit`: JSONL trail of every use and denial, tagged with the calling agent
- `keymark recipients add`: share the vault with teammates (age recipients, automatic re-encryption)
- `keymark install claude`: Claude Code `PreToolUse` hook blocking reads of `.env`, SSH keys, env dumps… plus a `rules/keymark.md` teaching the model to use references
