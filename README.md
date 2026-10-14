# pstack-portable

Vendors [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack), a
Cursor plugin, into any project so it works in **Amp** (including Amp Orbs),
**Claude Code**, **Codex** and **Grok Build** (xAI's `grok` CLI). You choose
the model for each pstack role in a `pstack.config.yaml` you commit with the
project.

It converts Cursor's [Thermos](https://github.com/cursor/plugins/tree/main/thermos)
plugin the same way with `--plugin thermos`: the `thermos`,
`thermo-nuclear-review` and `thermo-nuclear-code-quality-review` skills plus
their two review subagents. Thermos names no models, so it has no config.

And [Cursor Team Kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit)
with `--plugin cursor-team-kit`: CI, review, shipping and verification skills,
the `ci-watcher` agent, and its Cursor rules. It leaves out its copy of
`thermo-nuclear-code-quality-review`, which Thermos ships too.

This repo holds only the converter and a few overrides, not the plugins. Each
sync fetches the plugin from upstream, so you never merge upstream changes by hand.

## Use

At a project root:

```bash
npx github:robertguss/pstack-portable           # first install, or re-sync the pinned version
npx github:robertguss/pstack-portable --latest  # update to upstream main
npx github:robertguss/pstack-portable --plugin thermos  # Thermos; add --latest to update
npx github:robertguss/pstack-portable --plugin cursor-team-kit
git status && git diff                          # review, then commit
```

Each plugin has its own pin, so sync each one separately. Other flags:
`--ref <full sha>` to pin a specific upstream commit, `--source <dir>` to use a
local plugin checkout, `--dir <path>` to sync a different project root,
`--force` to overwrite paths it didn't write.

Everything it writes is committed, so orbs and fresh clones need no network or
setup.

## What it writes

| Path                                          | For                | Notes                                                                                                       |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `.agents/skills/<skill>/`                     | Amp, Codex, Grok   | Every pstack skill, with Cursor paths rewritten and a harness note added                                    |
| `.claude/skills/<skill>`                      | Claude Code        | Symlinks into `.agents/skills/`                                                                             |
| `.claude/agents/*.md`, `.codex/agents/*.toml` | Claude Code, Codex | `poteto-agent`, `comment-sicko`                                                                             |
| `.grok/agents/*.md`                           | Grok Build         | Same two agents                                                                                             |
| `.amp/plugins/pstack.ts`                      | Amp                | `pstack_subagent` tool: runs a subagent on any Amp model, since Amp's built-in Task tool can't take a model |
| `.agents/pstack/HARNESS.md`                   | all                | Maps pstack's Cursor terms (Task, AskQuestion, transcripts) to each harness                                 |
| `.agents/pstack/lock.json`                    | sync               | Pinned upstream commit and the list of files sync owns                                                      |
| `pstack.config.yaml`                          | you                | Created once, never overwritten; sync only appends roles upstream adds                                      |

Thermos writes the same kinds of files under its own names: its skills and
`thermo-nuclear-*-subagent` agents, `.agents/thermos/HARNESS.md` and
`.agents/thermos/lock.json`. It has no Amp plugin and no config; in Amp its
subagents run through the built-in Task tool.

Cursor Team Kit does the same under `.agents/cursor-team-kit/`, and also writes
its two always-on Cursor rules (no inline imports, exhaustive TypeScript
switches) to `.agents/cursor-team-kit/RULES.md`. Sync never edits your
instructions files, so the rules apply only once you point to them: add
`@.agents/cursor-team-kit/RULES.md` to `CLAUDE.md` or Amp's `AGENTS.md`, or
"Follow `.agents/cursor-team-kit/RULES.md`." to `AGENTS.md` for Codex and Grok Build.

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
    grok: grok-4.7-build-fast
  arena-runners: # a list is a panel: one subagent per entry
    amp: [anthropic/claude-opus-5@xhigh, xai/grok-4.6]
    claude-code: [opus, sonnet]
    codex: [inherit, inherit]
    grok: [grok-4.7, grok-4.7-build-fast]
```

- `inherit` runs the role on the thread's own model.
- `model@effort` sets reasoning effort; Claude Code and Grok Build ignore the
  effort.
- Edits apply on the next spawn, with no re-sync needed. `/setup-pstack` edits
  the file for you.
- Amp model ids come from `amp plugins show-agent-options`; Grok Build ids from
  `grok models`.
- The defaults mirror upstream's split: Grok for code, Opus for judgment. Codex
  defaults to `inherit`; Grok Build to `grok-4.7` and `grok-4.7-build-fast`.

## Changing the conversion

- `overrides/<plugin>/<path>` replaces that upstream file verbatim.
  `overrides/pstack/skills/setup-pstack/SKILL.md` is one. Record the upstream commit
  and sha256 of the file it replaces in `overrides/upstream.json`; the daily
  Upstream check workflow fails when upstream changes that file.
- `defaults.json` maps upstream's Cursor model slugs to default values per
  harness. Sync warns about a slug that has no entry.
- `templates/<plugin>/` holds each plugin's HARNESS.md, and pstack's Amp plugin.
- `skip` in `PLUGINS` leaves upstream paths out; sync warns when one is gone.
- To add another cursor/plugins plugin, add it to `PLUGINS` in `lib/sync.mjs`,
  write `templates/<plugin>/HARNESS.md`, and add it to the upstream check workflow.
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
- Grok Build reads `.agents/skills/` itself, but only after you trust the project
  folder. If you turn on its `subagent_model_inheritance` setting, every role
  runs on the session's model.
- Thermos skills set `disable-model-invocation`, so in Claude Code you start
  them yourself (`/thermos`); its subagents read the rubric skills as files.

- Agent `model:` frontmatter names Cursor models (such as `fast` on
  `ci-watcher`), so sync drops it and those agents run on your own model.
- `pr-review-canvas` opens its page in Cursor's in-app browser. Elsewhere the
  agent uses a browser tool if it has one, or gives you the URL.

pstack is MIT-licensed, © Lauren Tan. Thermos and Cursor Team Kit are
MIT-licensed, © Cursor.
Each LICENSE is copied to `.agents/<plugin>/LICENSE` in every project.
