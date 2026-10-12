#!/usr/bin/env node
import { sync } from '../lib/sync.mjs'

const USAGE = `Usage: pstack-portable [sync] [options]

Vendors Cursor's pstack into the current project for Amp, Claude Code and Codex.

  --latest        Move the pin to upstream main before syncing
  --ref <sha>     Sync a specific full cursor/plugins commit
  --source <dir>  Use a local pstack directory instead of fetching
  --dir <path>    Project root (default: current directory)
  --force         Overwrite paths pstack-portable did not write
  -h, --help      Show this help`

const args = process.argv.slice(2)
if (args[0] === 'sync') args.shift()
const opts = { dir: process.cwd() }
while (args.length) {
  const arg = args.shift()
  if (arg === '--latest') opts.latest = true
  else if (arg === '--force') opts.force = true
  else if (['--ref', '--source', '--dir'].includes(arg) && args[0]) opts[arg.slice(2)] = args.shift()
  else {
    console.log(USAGE)
    process.exit(arg === '-h' || arg === '--help' ? 0 : 1)
  }
}

try {
  const s = sync(opts.dir, opts)
  console.log(`pstack ${s.from ? `${s.from} -> ` : ''}${s.to} (cursor/plugins ${s.sha.slice(0, 12)})`)
  console.log(`files: ${s.added} added, ${s.changed} changed, ${s.removed} removed`)
  const c = s.config
  if (c.created) console.log(`created pstack.config.yaml with ${c.added.length} roles`)
  else if (c.added.length) console.log(`pstack.config.yaml: appended new roles ${c.added.join(', ')}; review their models`)
  if (c.stale.length) console.log(`pstack.config.yaml: upstream no longer uses ${c.stale.join(', ')}; safe to delete`)
  for (const w of s.warnings) console.log(`warning: ${w}`)
  console.log('Review with `git status` and `git diff`, then commit.')
} catch (e) {
  console.error(`pstack-portable: ${e.message}`)
  process.exit(1)
}
