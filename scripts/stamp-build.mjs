import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import './check-build-inputs.mjs';

// stamp-build.mjs <sha>          stamp the build just made from <sha>
// stamp-build.mjs <sha> --reuse  exit 0 only if dist/ is still exactly the build stamped at <sha>
//   (a release builds and stamps the same commit the desktop update then ships; no second build).
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.argv[2] !== sha) throw new Error('HEAD changed during the build. Rebuild the new commit.');
const reuse = process.argv.includes('--reuse');
const stampPath = 'packages/openwriter/dist/build-info.json';
if (reuse && !existsSync(stampPath)) process.exit(1);
const pkg = JSON.parse(readFileSync('packages/openwriter/package.json', 'utf8'));
const html = readFileSync('packages/openwriter/dist/client/index.html', 'utf8');
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m => m[1]);
if (!assets.some(asset => asset.endsWith('.js'))) throw new Error('Client entry asset missing.');
const files = [];
function collect(directory, relative = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(join(directory, entry.name), name);
    else if (name !== 'build-info.json') files.push(name);
  }
}
collect('packages/openwriter/dist');
for (const required of ['server/index.js', 'bin/pad.js', ...assets.map(asset => `client${asset}`)]) {
  if (!files.includes(required)) throw new Error(`Built artifact missing: ${required}`);
}
const hash = createHash('sha256');
for (const file of files.sort()) {
  const path = join('packages/openwriter/dist', file);
  if (!existsSync(path)) throw new Error(`Built artifact missing: ${file}`);
  hash.update(file).update('\0').update(readFileSync(path));
}
const artifact = hash.digest('hex');
if (reuse) {
  // Same commit, same version, and not one byte of dist/ changed since it was stamped.
  const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
  if (stamp.sha !== sha || stamp.version !== pkg.version || stamp.artifact !== artifact) process.exit(1);
  console.log(`Reusing the OpenWriter ${pkg.version} build already stamped at ${sha}`);
  process.exit(0);
}
const stamp = { sha, version: pkg.version, builtAt: new Date().toISOString(), artifact };
writeFileSync(stampPath, JSON.stringify(stamp, null, 2) + '\n');
console.log(`Stamped OpenWriter ${pkg.version} at ${sha}`);
