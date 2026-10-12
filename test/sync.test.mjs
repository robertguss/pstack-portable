import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CONFIG, LOCK, sync } from '../lib/sync.mjs'

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixture/pstack')
const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pstack-project-'))
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')

test('writes skills, wiring, config and lock for every harness', () => {
  const dir = project()
  const s = sync(dir, { source })
  assert.equal(s.to, '0.0.1')

  const skill = read(dir, '.agents/skills/poteto-mode/SKILL.md')
  assert.match(skill, /^---\nname: poteto-mode\n[\s\S]*---\n\n> \*\*Harness note/)
  assert.doesNotMatch(skill, /pstack-models\.mdc|\.cursor\//)
  assert.match(skill, /`arena runners` line in `pstack\.config\.yaml`, or the `pstack\.config\.yaml`\. Skills live in `\.agents\/skills\/`/)
  assert.ok(fs.statSync(path.join(dir, '.agents/skills/poteto-mode/scripts/run.sh')).mode & 0o100, 'keeps exec bit')
  assert.match(read(dir, '.agents/skills/setup-pstack/SKILL.md'), /pstack-portable replaced/, 'override wins')

  assert.equal(fs.readlinkSync(path.join(dir, '.claude/skills/poteto-mode')), '../../.agents/skills/poteto-mode')
  assert.ok(fs.existsSync(path.join(dir, '.claude/skills/poteto-mode/SKILL.md')), 'symlink resolves')

  assert.doesNotMatch(read(dir, '.claude/agents/poteto-agent.md'), /is_background/)
  const toml = read(dir, '.codex/agents/poteto-agent.toml')
  assert.match(toml, /^name = "poteto-agent"$/m)
  assert.match(toml, /^description = "Delegate \\"quoted\\" subagent\."$/m)

  const plugin = read(dir, '.amp/plugins/pstack.ts')
  assert.doesNotMatch(plugin, /__AGENTS__/)
  assert.match(plugin, /"poteto-agent": "> \*\*Harness note/)

  const config = read(dir, CONFIG)
  assert.match(config, /^ {2}feature-refactoring: .*\n {4}amp: xai\/grok-4\.6\n {4}claude-code: sonnet\n {4}codex: inherit$/m)
  assert.match(config, /^ {2}arena-runners: .*\n {4}amp: \[anthropic\/claude-opus-5@xhigh, xai\/grok-4\.6\]$/m)
  assert.ok(JSON.parse(read(dir, LOCK)).files.includes('.amp/plugins/pstack.ts'))
})

test('re-sync is a no-op and keeps config edits; missing roles are appended', () => {
  const dir = project()
  sync(dir, { source })
  const edited = read(dir, CONFIG).replace('claude-code: sonnet', 'claude-code: haiku').replace(/ {2}arena-runners:[\s\S]*$/, '')
  fs.writeFileSync(path.join(dir, CONFIG), edited)

  const s = sync(dir, { source })
  assert.deepEqual([s.added, s.changed, s.removed], [0, 0, 0])
  assert.deepEqual(s.config.added, ['arena-runners'])
  const config = read(dir, CONFIG)
  assert.match(config, /claude-code: haiku/)
  assert.match(config, /# added by pstack-portable sync for pstack 0\.0\.1\n {2}arena-runners:/)
})

test('removes files it generated that upstream dropped', () => {
  const dir = project()
  sync(dir, { source })
  const lock = JSON.parse(read(dir, LOCK))
  fs.mkdirSync(path.join(dir, '.agents/skills/gone'))
  fs.writeFileSync(path.join(dir, '.agents/skills/gone/SKILL.md'), 'old')
  lock.files.push('.agents/skills/gone/SKILL.md')
  fs.writeFileSync(path.join(dir, LOCK), JSON.stringify(lock))

  assert.equal(sync(dir, { source }).removed, 1)
  assert.ok(!fs.existsSync(path.join(dir, '.agents/skills/gone')), 'prunes the empty dir')
})

test('refuses to overwrite files it did not write unless forced', () => {
  const dir = project()
  fs.mkdirSync(path.join(dir, '.agents/skills/poteto-mode'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.agents/skills/poteto-mode/SKILL.md'), 'mine')
  assert.throws(() => sync(dir, { source }), /\.agents\/skills\/poteto-mode\/SKILL\.md/)
  assert.equal(read(dir, '.agents/skills/poteto-mode/SKILL.md'), 'mine')
  sync(dir, { source, force: true })
  assert.match(read(dir, '.agents/skills/poteto-mode/SKILL.md'), /Harness note/)
})
