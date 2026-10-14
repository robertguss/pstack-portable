import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const UPSTREAM = 'https://github.com/cursor/plugins'
export const CONFIG = 'pstack.config.yaml'
// Cursor plugins in cursor/plugins this converts. `roles`: per-role models in pstack.config.yaml and the Amp plugin.
// `skip`: upstream paths left out: swarm because it is too expensive to run, the cursor-team-kit ones because Thermos ships the same skill and agent.
export const PLUGINS = {
  pstack: { roles: true, uses: 'spawn subagents, ask structured questions or read transcripts', skip: ['skills/swarm'] },
  thermos: { uses: 'spawn subagents or load another skill' },
  'cursor-team-kit': {
    uses: 'spawn subagents, read chat transcripts, open the in-app browser or write a Cursor rule',
    skip: ['skills/thermo-nuclear-code-quality-review', 'agents/thermo-nuclear-code-quality-review.md'],
  },
}
export const lockFile = (plugin) => `.agents/${plugin}/lock.json`
const HARNESSES = ['amp', 'claude-code', 'codex', 'grok']
const SKIP = new Set(['node_modules', '.DS_Store'])
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'defaults.json'), 'utf8'))

const note = (plugin) =>
  `> **Harness note (pstack-portable):** this skill was written for Cursor. Before you ${PLUGINS[plugin].uses}, ` +
  `read \`.agents/${plugin}/HARNESS.md\` for the Amp, Claude Code, Codex and Grok Build equivalents.` +
  (PLUGINS[plugin].roles ? ' Role models come from `pstack.config.yaml`.' : '') + '\n'

const REWRITES = [
  [/~\/\.cursor\/rules\/pstack-models\.mdc/g, CONFIG],
  [/`pstack-models\.mdc` rule/g, '`pstack.config.yaml`'],
  [/pstack-models\.mdc/g, CONFIG],
  [/\.cursor\/skills\//g, '.agents/skills/'],
]

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export const resolveLatest = () => git(process.cwd(), 'ls-remote', UPSTREAM, 'HEAD').split(/\s/)[0]

export function fetchUpstream(ref, plugin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${plugin}-upstream-`))
  git(dir, 'init', '-q')
  git(dir, 'remote', 'add', 'origin', UPSTREAM)
  git(dir, 'sparse-checkout', 'set', plugin)
  git(dir, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', ref)
  git(dir, 'checkout', '-q', 'FETCH_HEAD')
  return path.join(dir, plugin)
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return []
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p)]
  })
}

const splitFrontmatter = (md) => {
  const m = md.match(/^---\n[\s\S]*?\n---\n/)
  return m ? [m[0], md.slice(m[0].length)] : ['', md]
}

const rewrite = (md) => REWRITES.reduce((s, [re, to]) => s.replace(re, to), md)

function injectNote(md, plugin) {
  const [front, body] = splitFrontmatter(md)
  return `${front}\n${note(plugin)}\n${body.replace(/^\n+/, '')}`
}

export const slug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function parseRoles(setupMd) {
  const block = setupMd.split('### 5.')[1]?.match(/```\n([\s\S]*?)```/)?.[1] ?? ''
  const roles = [...block.split(/^---$/m).pop().matchAll(/^([a-z][^:#\n]*): (.+)$/gm)].map(
    ([, label, value]) => ({ label, models: value.split(',').map((s) => s.trim()) }),
  )
  if (!roles.length)
    throw new Error('No role table found in upstream skills/setup-pstack/SKILL.md step 5; the converter needs updating.')
  return roles
}

function roleYaml({ label, models }, warnings) {
  const pick = (h) =>
    models.map((m) => {
      if (!DEFAULTS[m]) warnings.add(`No harness mapping for Cursor model "${m}" (role "${label}"); defaulting to inherit. Add it to defaults.json.`)
      return DEFAULTS[m]?.[h] ?? 'inherit'
    })
  const value = (h) => (models.length > 1 ? `[${pick(h).join(', ')}]` : pick(h)[0])
  return `  ${slug(label)}: # pstack role "${label}" (Cursor default: ${models.join(', ')})\n` +
    HARNESSES.map((h) => `    ${h}: ${value(h)}\n`).join('')
}

const CONFIG_HEADER = `# pstack.config.yaml: which model each pstack role uses, per harness.
# Yours to edit; pstack-portable sync never overwrites a value, it only appends roles upstream adds.
# Edits apply on the next subagent spawn, no re-sync needed.
#
# Keys are pstack's role labels slugged: "feature, refactoring" -> feature-refactoring.
# Values: a model id, "model@effort" (effort: low|medium|high|xhigh|max), or "inherit"
# (run on the thread's own model). List values are panels: one subagent per entry.
#   amp:         provider/model ids from \`amp plugins show-agent-options\`
#   claude-code: opus | sonnet | haiku | fable, or a full claude-* id (effort is ignored)
#   codex:       a Codex model id, e.g. the one \`codex\` prints at startup
#   grok:        a Grok Build model id from \`grok models\` (effort is ignored)
roles:
`

function buildConfig(projectDir, roles, version, warnings) {
  const file = path.join(projectDir, CONFIG)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, CONFIG_HEADER + roles.map((r) => roleYaml(r, warnings)).join(''))
    return { created: true, added: roles.map((r) => slug(r.label)), stale: [] }
  }
  const text = fs.readFileSync(file, 'utf8')
  const present = new Set([...text.matchAll(/^ {2}([a-z0-9-]+):/gm)].map((m) => m[1]))
  const missing = roles.filter((r) => !present.has(slug(r.label)))
  if (missing.length)
    fs.writeFileSync(file, text.replace(/\n*$/, '\n') + `  # added by pstack-portable sync for pstack ${version}\n` +
      missing.map((r) => roleYaml(r, warnings)).join(''))
  const known = new Set(roles.map((r) => slug(r.label)))
  return { created: false, added: missing.map((r) => slug(r.label)), stale: [...present].filter((s) => !known.has(s)) }
}

function agentParts(md) {
  const [front, body] = splitFrontmatter(md)
  const field = (k) => front.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim()
  return { name: field('name'), description: field('description'), front, body: body.replace(/^\n+/, '') }
}

// Every generated file, keyed by project-relative path. Values are { content, mode } or { symlink }.
export function buildOutputs(pluginDir, { plugin, sha, version }) {
  const out = new Map()
  const overrides = path.join(ROOT, 'overrides', plugin)
  const overridden = new Set(fs.existsSync(overrides) ? walk(overrides) : [])
  const skipped = (rel) => PLUGINS[plugin].skip?.some((s) => rel === s || rel.startsWith(`${s}/`))

  for (const rel of walk(path.join(pluginDir, 'skills'))) {
    const key = path.join('skills', rel)
    if (skipped(key)) continue
    const src = overridden.has(key) ? path.join(overrides, key) : path.join(pluginDir, key)
    let content = fs.readFileSync(src)
    if (!overridden.has(key) && rel.endsWith('.md')) {
      content = rewrite(content.toString('utf8'))
      if (path.basename(rel) === 'SKILL.md') content = injectNote(content, plugin)
    }
    out.set(path.join('.agents', key), { content, mode: fs.statSync(src).mode & 0o777 })
  }
  for (const name of fs.readdirSync(path.join(pluginDir, 'skills'), { withFileTypes: true })) {
    if (name.isDirectory() && !skipped(`skills/${name.name}`)) out.set(path.join('.claude/skills', name.name), { symlink: `../../.agents/skills/${name.name}` })
  }

  const agents = {}
  for (const file of fs.readdirSync(path.join(pluginDir, 'agents')).filter((f) => f.endsWith('.md') && !skipped(`agents/${f}`))) {
    const md = rewrite(fs.readFileSync(path.join(pluginDir, 'agents', file), 'utf8'))
    const { name, description, front, body } = agentParts(md)
    const notedBody = `${note(plugin)}\n${body}`
    agents[name] = notedBody
    // is_background and model (Cursor slugs such as `fast`) are Cursor-only frontmatter.
    const agentMd = `${front.replace(/^(is_background|model):.*\n/gm, '')}\n${notedBody}`
    out.set(path.join('.claude/agents', file), { content: agentMd })
    out.set(path.join('.grok/agents', file), { content: agentMd })
    // JSON string escapes are valid TOML basic-string escapes.
    out.set(path.join('.codex/agents', `${name}.toml`), {
      content: `# Generated by pstack-portable from ${plugin} ${version}. Do not edit; re-run sync.\n` +
        `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(description)}\n` +
        `developer_instructions = ${JSON.stringify(notedBody)}\n`,
    })
  }

  const template = (f) => fs.readFileSync(path.join(ROOT, 'templates', plugin, f), 'utf8')
  if (PLUGINS[plugin].roles)
    out.set('.amp/plugins/pstack.ts', { content: template('amp-plugin.ts').replace('__AGENTS__', JSON.stringify(agents, null, 2)) })
  out.set(`.agents/${plugin}/HARNESS.md`, { content: template('HARNESS.md').replaceAll('__VERSION__', version).replaceAll('__SHA__', sha) })
  out.set(`.agents/${plugin}/LICENSE`, { content: fs.readFileSync(path.join(pluginDir, 'LICENSE')) })

  const rulesDir = path.join(pluginDir, 'rules')
  if (fs.existsSync(rulesDir)) {
    const rules = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.mdc')).sort().map((f) => {
      const [front, body] = splitFrontmatter(rewrite(fs.readFileSync(path.join(rulesDir, f), 'utf8')))
      const when = front.match(/^globs:\s*(.+)$/m)?.[1] ?? front.match(/^description:\s*(.+)$/m)?.[1]
      const scope = /^alwaysApply:\s*true\s*$/m.test(front) || !when ? '' : `_Applies only to: ${when.trim()}_\n\n`
      return `## ${f.replace(/\.mdc$/, '')}\n\n${scope}${body.trim()}\n`
    })
    out.set(`.agents/${plugin}/RULES.md`, {
      content: `# ${plugin} rules\n\nGenerated by pstack-portable from ${plugin} ${version}. Do not edit; re-run sync.\n` +
        `These were Cursor rules. They apply only where AGENTS.md or CLAUDE.md points here.\n\n${rules.join('\n')}`,
    })
  }
  return out
}

const lexists = (p) => {
  try {
    fs.lstatSync(p)
    return true
  } catch {
    return false
  }
}

function sameAs(file, output) {
  if (!lexists(file)) return false
  const stat = fs.lstatSync(file)
  if (output.symlink) return stat.isSymbolicLink() && fs.readlinkSync(file) === output.symlink
  return stat.isFile() && fs.readFileSync(file).equals(Buffer.from(output.content))
}

function removeAndPrune(projectDir, rel) {
  fs.rmSync(path.join(projectDir, rel), { force: true })
  for (let dir = path.dirname(rel); dir !== '.'; dir = path.dirname(dir)) {
    const abs = path.join(projectDir, dir)
    if (!fs.existsSync(abs) || fs.readdirSync(abs).length) break
    fs.rmdirSync(abs)
  }
}

export function sync(projectDir, { plugin = 'pstack', ref, latest, source, force } = {}) {
  if (!PLUGINS[plugin]) throw new Error(`Unknown plugin "${plugin}"; expected one of ${Object.keys(PLUGINS).join(', ')}.`)
  const lockPath = path.join(projectDir, lockFile(plugin))
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { files: [] }
  if (source) {
    let sha = 'local'
    try {
      sha = git(path.resolve(source), 'rev-parse', 'HEAD')
    } catch {}
    return syncFrom(projectDir, plugin, path.resolve(source), sha, lock, force)
  }
  const sha = ref ?? (latest || !lock.upstream ? resolveLatest() : lock.upstream.ref)
  const pluginDir = fetchUpstream(sha, plugin)
  try {
    return syncFrom(projectDir, plugin, pluginDir, sha, lock, force)
  } finally {
    fs.rmSync(path.dirname(pluginDir), { recursive: true, force: true })
  }
}

function syncFrom(projectDir, plugin, pluginDir, sha, lock, force) {
  const lockPath = path.join(projectDir, lockFile(plugin))
  const manifest = ['.cursor-plugin/plugin.json', 'plugin.json'].map((f) => path.join(pluginDir, f)).find((f) => fs.existsSync(f))
  const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version
  const outputs = buildOutputs(pluginDir, { plugin, sha, version })
  const owned = new Set(lock.files)

  const conflicts = [...outputs.keys()].filter((p) => !owned.has(p) && lexists(path.join(projectDir, p)))
  if (conflicts.length && !force)
    throw new Error(`These paths exist but were not written by pstack-portable; move them or pass --force:\n  ${conflicts.join('\n  ')}`)

  const summary = { from: lock.upstream?.version, to: version, sha, added: 0, changed: 0, removed: 0 }
  for (const rel of owned) {
    if (!outputs.has(rel)) {
      removeAndPrune(projectDir, rel)
      summary.removed++
    }
  }
  for (const [rel, output] of outputs) {
    const file = path.join(projectDir, rel)
    if (sameAs(file, output)) continue
    summary[lexists(file) ? 'changed' : 'added']++
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.rmSync(file, { recursive: true, force: true })
    if (output.symlink) fs.symlinkSync(output.symlink, file)
    else fs.writeFileSync(file, output.content, { mode: output.mode ?? 0o644 })
  }

  const warnings = new Set()
  for (const s of PLUGINS[plugin].skip ?? [])
    if (!fs.existsSync(path.join(pluginDir, s))) warnings.add(`Upstream ${plugin} no longer has ${s}; remove it from skip in lib/sync.mjs.`)
  if (PLUGINS[plugin].roles) {
    const roles = parseRoles(fs.readFileSync(path.join(pluginDir, 'skills/setup-pstack/SKILL.md'), 'utf8'))
    summary.config = buildConfig(projectDir, roles, version, warnings)
  }
  summary.warnings = [...warnings]

  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  fs.writeFileSync(lockPath, JSON.stringify({ upstream: { repo: UPSTREAM, ref: sha, version }, files: [...outputs.keys()].sort() }, null, 2) + '\n')
  return summary
}
