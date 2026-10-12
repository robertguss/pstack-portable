# pstack-portable

Vendors [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack), a
Cursor plugin, into any project so it works in **Amp** (including Amp Orbs),
**Claude Code** and **Codex**. You choose the model for each pstack role in a
`pstack.config.yaml` you commit with the project.

This repo holds only the converter and a few overrides, not pstack itself. Each
sync fetches pstack from upstream, so you never merge upstream changes by hand.

## Use

At a project root:

```bash
npx github:robertguss/pstack-portable           # first install, or re-sync the pinned version
npx github:robertguss/pstack-portable --latest  # update to upstream main
git status && git diff                          # review, then commit
```

Other flags: `--ref <full sha>` to pin a specific upstream commit,
`--source <dir>` to use a local pstack checkout, `--dir <path>` to sync a
different project root, `--force` to overwrite paths it didn't write.

Everything it writes is committed, so orbs and fresh clones need no network or
setup.

## What it writes

| Path                                          | For                | Notes                                                                                                       |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `.agents/skills/<skill>/`                     | Amp, Codex         | Every pstack skill, with Cursor paths rewritten and a harness note added                                    |
| `.claude/skills/<skill>`                      | Claude Code        | Symlinks into `.agents/skills/`                                                                             |
| `.claude/agents/*.md`, `.codex/agents/*.toml` | Claude Code, Codex | `poteto-agent`, `comment-sicko`                                                                             |
| `.amp/plugins/pstack.ts`                      | Amp                | `pstack_subagent` tool: runs a subagent on any Amp model, since Amp's built-in Task tool can't take a model |
| `.agents/pstack/HARNESS.md`                   | all                | Maps pstack's Cursor terms (Task, AskQuestion, transcripts) to each harness                                 |
| `.agents/pstack/lock.json`                    | sync               | Pinned upstream commit and the list of files sync owns                                                      |
| `pstack.config.yaml`                          | you                | Created once, never overwritten; sync only appends roles upstream adds                                      |

Sync only replaces or deletes files listed in `lock.json`. If a path it would
write already exists and sync didn't create it, sync stops and lists it.

## Models

pstack sends each kind of work to a model by role: code work goes to a fast
coder, judgment and prose to a strong reasoner, and review panels mix models.
Each role has a value per harness:

```yaml
roles:
  feature-refactoring:
    amp: xai/grok-4.6
    claude-code: sonnet
    codex: inherit
  arena-runners: # a list is a panel: one subagent per entry
    amp: [anthropic/claude-opus-5@xhigh, xai/grok-4.6]
    claude-code: [opus, sonnet]
    codex: [inherit, inherit]
```

- `inherit` runs the role on the thread's own model.
- `model@effort` sets reasoning effort; Claude Code ignores the effort.
- Edits apply on the next spawn, with no re-sync needed. `/setup-pstack` edits
  the file for you.
- Amp model ids come from `amp plugins show-agent-options`.
- The defaults mirror upstream's split: Grok for code, Opus for judgment. Codex
  defaults to `inherit`.

## Changing the conversion

- `overrides/<path>` replaces that upstream file verbatim.
  `overrides/skills/setup-pstack/SKILL.md` is one.
- `defaults.json` maps upstream's Cursor model slugs to default values per
  harness. Sync warns about a slug that has no entry.
- `templates/` holds the Amp plugin and HARNESS.md.
- `npm test` runs the converter against `test/fixture/`.

## Known limits

- pstack features built on Cursor automations (Bugbot triage, webhooks,
  `make-bot-ui`) have no equivalent here. HARNESS.md tells agents to say so.
- `worktree-audit.sh` can only see Cursor transcripts, so its recent-chat guard
  is blind elsewhere. HARNESS.md makes agents confirm with you before removing a
  worktree.
- Claude Code drops descriptions from its skill listing when there are many
  skills, newest and least-used first. pstack's skills stay invocable by name.
  To fix it, raise `skillListingBudgetFraction` in settings.

pstack is MIT-licensed, © Lauren Tan. Its LICENSE is copied to
`.agents/pstack/LICENSE` in every project.
