import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const UPSTREAM = 'https://github.com/cursor/plugins'
export const LOCK = '.agents/pstack/lock.json'
export const CONFIG = 'pstack.config.yaml'
const HARNESSES = ['amp', 'claude-code', 'codex']
const SKIP = new Set(['node_modules', '.DS_Store'])
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'defaults.json'), 'utf8'))

const NOTE =
  '> **Harness note (pstack-portable):** this skill was written for Cursor. Before you spawn ' +
  'subagents, ask structured questions or read transcripts, read `.agents/pstack/HARNESS.md` ' +
  'for the Amp, Claude Code and Codex equivalents. Role models come from `pstack.config.yaml`.\n'

const REWRITES = [
  [/~\/\.cursor\/rules\/pstack-models\.mdc/g, CONFIG],
  [/`pstack-models\.mdc` rule/g, '`pstack.config.yaml`'],
  [/pstack-models\.mdc/g, CONFIG],
  [/\.cursor\/skills\//g, '.agents/skills/'],
]

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export const resolveLatest = () => git(process.cwd(), 'ls-remote', UPSTREAM, 'HEAD').split(/\s/)[0]

export function fetchUpstream(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pstack-upstream-'))
  git(dir, 'init', '-q')
  git(dir, 'remote', 'add', 'origin', UPSTREAM)
  git(dir, 'sparse-checkout', 'set', 'pstack')
  git(dir, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', ref)
  git(dir, 'checkout', '-q', 'FETCH_HEAD')
  return path.join(dir, 'pstack')
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

function injectNote(md) {
  const [front, body] = splitFrontmatter(md)
  return `${front}\n${NOTE}\n${body.replace(/^\n+/, '')}`
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
export function buildOutputs(pstackDir, { sha, version }) {
  const out = new Map()
  const overrides = path.join(ROOT, 'overrides')
  const overridden = new Set(fs.existsSync(overrides) ? walk(overrides) : [])

  for (const rel of walk(path.join(pstackDir, 'skills'))) {
    const key = path.join('skills', rel)
    const src = overridden.has(key) ? path.join(overrides, key) : path.join(pstackDir, key)
    let content = fs.readFileSync(src)
    if (!overridden.has(key) && rel.endsWith('.md')) {
      content = rewrite(content.toString('utf8'))
      if (path.basename(rel) === 'SKILL.md') content = injectNote(content)
    }
    out.set(path.join('.agents', key), { content, mode: fs.statSync(src).mode & 0o777 })
  }
  for (const name of fs.readdirSync(path.join(pstackDir, 'skills'), { withFileTypes: true })) {
    if (name.isDirectory()) out.set(path.join('.claude/skills', name.name), { symlink: `../../.agents/skills/${name.name}` })
  }

  const agents = {}
  for (const file of fs.readdirSync(path.join(pstackDir, 'agents')).filter((f) => f.endsWith('.md'))) {
    const md = rewrite(fs.readFileSync(path.join(pstackDir, 'agents', file), 'utf8'))
    const { name, description, front, body } = agentParts(md)
    const notedBody = `${NOTE}\n${body}`
    agents[name] = notedBody
    // is_background is Cursor-only frontmatter.
    out.set(path.join('.claude/agents', file), { content: `${front.replace(/^is_background:.*\n/m, '')}\n${notedBody}` })
    // JSON string escapes are valid TOML basic-string escapes.
    out.set(path.join('.codex/agents', `${name}.toml`), {
      content: `# Generated by pstack-portable from pstack ${version}. Do not edit; re-run sync.\n` +
        `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(description)}\n` +
        `developer_instructions = ${JSON.stringify(notedBody)}\n`,
    })
  }

  const template = (f) => fs.readFileSync(path.join(ROOT, 'templates', f), 'utf8')
  out.set('.amp/plugins/pstack.ts', { content: template('amp-plugin.ts').replace('__AGENTS__', JSON.stringify(agents, null, 2)) })
  out.set('.agents/pstack/HARNESS.md', { content: template('HARNESS.md').replaceAll('__VERSION__', version).replaceAll('__SHA__', sha) })
  out.set('.agents/pstack/LICENSE', { content: fs.readFileSync(path.join(pstackDir, 'LICENSE')) })
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

export function sync(projectDir, { ref, latest, source, force } = {}) {
  const lockPath = path.join(projectDir, LOCK)
  const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : { files: [] }
  if (source) {
    let sha = 'local'
    try {
      sha = git(path.resolve(source), 'rev-parse', 'HEAD')
    } catch {}
    return syncFrom(projectDir, path.resolve(source), sha, lock, force)
  }
  const sha = ref ?? (latest || !lock.upstream ? resolveLatest() : lock.upstream.ref)
  const pstackDir = fetchUpstream(sha)
  try {
    return syncFrom(projectDir, pstackDir, sha, lock, force)
  } finally {
    fs.rmSync(path.dirname(pstackDir), { recursive: true, force: true })
  }
}

function syncFrom(projectDir, pstackDir, sha, lock, force) {
  const lockPath = path.join(projectDir, LOCK)
  const version = JSON.parse(fs.readFileSync(path.join(pstackDir, 'plugin.json'), 'utf8')).version
  const outputs = buildOutputs(pstackDir, { sha, version })
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
  const roles = parseRoles(fs.readFileSync(path.join(pstackDir, 'skills/setup-pstack/SKILL.md'), 'utf8'))
  summary.config = buildConfig(projectDir, roles, version, warnings)
  summary.warnings = [...warnings]

  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  fs.writeFileSync(lockPath, JSON.stringify({ upstream: { repo: UPSTREAM, ref: sha, version }, files: [...outputs.keys()].sort() }, null, 2) + '\n')
  return summary
}
