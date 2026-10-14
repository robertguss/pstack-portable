# pstack-portable

Vendors Cursor plugins from [cursor/plugins](https://github.com/cursor/plugins)
into any project so they work in **Amp** (including Amp Orbs), **Claude Code**,
**Codex** and **Grok Build** (xAI's `grok` CLI).

| Plugin                                                                         | Flag                       | What you get                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------- |
| [pstack](https://github.com/cursor/plugins/tree/main/pstack)                   | default                    | poteto's skills and subagents, with the model for each role set in `pstack.config.yaml`            |
| [Thermos](https://github.com/cursor/plugins/tree/main/thermos)                 | `--plugin thermos`         | Thermo-nuclear branch review: bug/security and code-quality reviewers run in parallel, then merged |
| [Cursor Team Kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit) | `--plugin cursor-team-kit` | CI, review, shipping and verification skills, the `ci-watcher` agent, and two coding rules         |

This repo holds only the converter and a few overrides, not the plugins. Each
sync fetches the plugin from upstream, so you never merge upstream changes by
hand.

## Use

At a project root:

```bash
npx github:robertguss/pstack-portable                            # pstack: first install, or re-sync the pinned version
npx github:robertguss/pstack-portable --latest                   # pstack: update to upstream main
npx github:robertguss/pstack-portable --plugin thermos           # Thermos
npx github:robertguss/pstack-portable --plugin cursor-team-kit   # Cursor Team Kit
git status && git diff                                           # review, then commit
```

Each plugin has its own pin, so install and update each one separately; add
`--latest` to any of them to move it to upstream main. Install any mix: they
share a project without touching each other's files.

Other flags: `--ref <full sha>` to pin a specific upstream commit,
`--source <dir>` to use a local plugin checkout, `--dir <path>` to sync a
different project root, `--force` to overwrite paths it didn't write.

Everything it writes is committed, so orbs and fresh clones need no network or
setup.

## What it writes

| Path                                          | For                | Notes                                                                               |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `.agents/skills/<skill>/`                     | Amp, Codex, Grok   | Every skill, with Cursor paths rewritten and a harness note added                   |
| `.claude/skills/<skill>`                      | Claude Code        | Symlinks into `.agents/skills/`                                                     |
| `.claude/agents/*.md`, `.codex/agents/*.toml` | Claude Code, Codex | The plugin's subagents                                                              |
| `.grok/agents/*.md`                           | Grok Build         | The same subagents                                                                  |
| `.agents/<plugin>/HARNESS.md`                 | all                | Maps the plugin's Cursor terms (Task, AskQuestion, transcripts, …) to each harness  |
| `.agents/<plugin>/lock.json`                  | sync               | Pinned upstream commit and the list of files sync owns                              |
| `.agents/<plugin>/LICENSE`                    | all                | The plugin's license                                                                |
| `.amp/plugins/pstack.ts`                      | Amp                | pstack only: `pstack_subagent` runs a subagent on any Amp model                     |
| `pstack.config.yaml`                          | you                | pstack only: created once, never overwritten; sync only appends roles upstream adds |
| `.agents/cursor-team-kit/RULES.md`            | you                | Cursor Team Kit only: its Cursor rules, applied once you point to them (see below)  |

Sync only replaces or deletes files listed in that plugin's `lock.json`. If a
path it would write already exists and sync didn't create it, sync stops and
lists it.

## pstack

pstack sends each kind of work to a model by role: code work goes to a fast
coder, judgment and prose to a strong reasoner, and review panels mix models.
Each role has a value per harness in `pstack.config.yaml`:

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
- Amp's built-in Task tool can't take a model, so the generated
  `.amp/plugins/pstack.ts` adds a `pstack_subagent` tool that can.

## Thermos

Run `/thermos` on a branch. The agent gathers the
diff, then runs two reviewers in parallel and merges their findings:

- `thermo-nuclear-review-subagent`: bugs, breaking changes, security, devex
  regressions and feature-flag leaks, scoped to the diff.
- `thermo-nuclear-code-quality-review-subagent`: maintainability, structure, the
  1k-line rule, spaghetti growth and missed simplifications.

The `thermo-nuclear-review` and `thermo-nuclear-code-quality-review` skills run
either review on its own.

All three skills set `disable-model-invocation`, so in Claude Code you start
them yourself. The subagents read the rubric skills as files. Thermos names no
models, so every reviewer runs on your own model and there is no config. In Amp
the reviewers run through the built-in Task tool.

## Cursor Team Kit

17 workflow skills:

- **CI:** `loop-on-ci`, `fix-ci`, `check-compiler-errors`, `run-smoke-tests`
- **Review and shipping:** `review-and-ship`, `pr-review-canvas`,
  `make-pr-easy-to-review`, `new-branch-and-pr`, `get-pr-comments`,
  `fix-merge-conflicts`, `deslop`
- **Verification:** `verify-this`, `control-cli`, `control-ui`
- **Summaries:** `what-did-i-get-done`, `weekly-review`, `workflow-from-chats`

It also includes the `ci-watcher` agent, which watches a PR's checks in the
background.

Upstream also ships `thermo-nuclear-code-quality-review` in this kit. Sync
leaves it and its agent out because Thermos ships the same rubric; use
`--plugin thermos` for it.

**Rules.** The kit's two always-on Cursor rules (no inline imports, exhaustive
TypeScript switches) go to `.agents/cursor-team-kit/RULES.md`. Sync never edits
your instructions files, so the rules apply only once you point to them:

- Claude Code: add `@.agents/cursor-team-kit/RULES.md` to `CLAUDE.md`.
- Amp: add `@.agents/cursor-team-kit/RULES.md` to `AGENTS.md`.
- Codex and Grok Build: add "Follow `.agents/cursor-team-kit/RULES.md`." to
  `AGENTS.md`.

## Changing the conversion

- `PLUGINS` in `lib/sync.mjs` lists the plugins. `skip` there leaves upstream
  paths out, and sync warns when one is gone.
- `overrides/<plugin>/<path>` replaces that upstream file verbatim.
  `overrides/pstack/skills/setup-pstack/SKILL.md` is one. Record the upstream
  commit and sha256 of the file it replaces in `overrides/upstream.json`; the
  daily Upstream check workflow fails when upstream changes that file.
- `templates/<plugin>/` holds each plugin's HARNESS.md, and pstack's Amp plugin.
- `defaults.json` maps pstack's Cursor model slugs to default values per
  harness. Sync warns about a slug that has no entry.
- To add another cursor/plugins plugin, add it to `PLUGINS`, write
  `templates/<plugin>/HARNESS.md`, and add it to the upstream check workflow.
- `npm test` runs the converter against `test/fixture/`.
- The daily Upstream check workflow syncs every plugin from upstream main and
  fails on any warning, so upstream changes that need converter work email you.

## Known limits

All plugins:

- Claude Code drops descriptions from its skill listing when there are many
  skills, newest and least-used first. The skills stay invocable by name. To fix
  it, raise `skillListingBudgetFraction` in settings.
- Grok Build reads `.agents/skills/` itself, but only after you trust the
  project folder.
- Agent `model:` frontmatter names Cursor models (such as `fast` on
  `ci-watcher`), so sync drops it and those agents run on your own model.

pstack:

- Features built on Cursor automations (Bugbot triage, webhooks,
  `make-bot-ui`) have no equivalent here. HARNESS.md tells agents to say so.
- `worktree-audit.sh` can only see Cursor transcripts, so its recent-chat guard
  is blind elsewhere. HARNESS.md makes agents confirm with you before removing a
  worktree.
- If you turn on Grok Build's `subagent_model_inheritance` setting, every role
  runs on the session's model.

Cursor Team Kit:

- `pr-review-canvas` opens its page in Cursor's in-app browser. Elsewhere the
  agent uses a browser tool if it has one, or gives you the URL.

## License

pstack is MIT-licensed, © Lauren Tan. Thermos and Cursor Team Kit are
MIT-licensed, © Cursor. Each plugin's LICENSE is copied to
`.agents/<plugin>/LICENSE` in every project.
