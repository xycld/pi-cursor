#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const fail = (message) => {
  console.error(`Package surface check failed: ${message}`)
  process.exit(1)
}

if (pkg.name !== '@xycloud/pi-cursor') fail(`package name must be @xycloud/pi-cursor, got ${pkg.name}`)
if (Object.keys(pkg.bin ?? {}).join(',') !== 'pi-cursor') {
  fail(`only the pi-cursor binary may be published, got ${Object.keys(pkg.bin ?? {}).join(',') || '<none>'}`)
}

const pkgText = JSON.stringify(pkg)
for (const banned of ['@opencode-ai/plugin', '@opencode-ai/sdk', 'open-cursor']) {
  if (pkgText.includes(banned)) fail(`package metadata still exposes ${banned}`)
}

const packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const [pack] = JSON.parse(packOutput)
const files = (pack.files ?? []).map((file) => file.path)

const bannedPathPatterns = [
  /^src\//,
  /^tests\//,
  /^cmd\//,
  /^scripts\//,
  /^docs\/(?!(PUBLISHING\.md|header\.png)$)/,
  /^dist\/cli\//,
  /opencode/i,
  /open-cursor/i,
  /plugin-entry/,
  /sdk-runner\.mjs$/,
  /cursor-agent-runner\.mjs$/,
]

for (const file of files) {
  const banned = bannedPathPatterns.find((pattern) => pattern.test(file))
  if (banned) fail(`unexpected legacy path in package: ${file}`)
}

for (const required of [
  'bin/pi-cursor.js',
  'pi-extension/cursor-acp/index.ts',
  'pi-extension/cursor-acp/models.json',
  'pi-extension/cursor-acp/package.json',
  'dist/cursor-acp-extension.js',
  'README.md',
  'LICENSE',
]) {
  if (!files.includes(required)) fail(`missing required package file: ${required}`)
}

console.log(`Package surface OK (${files.length} files).`)
