/**
 * Build every plugin under ../../plugins that declares a `build` script.
 *
 * Why this exists: the app build (`vite build && tsc`) does NOT build the
 * plugins, and `npm publish` runs `prepublishOnly` (which bundles plugin
 * dist/) but NOT `npm run build`. Without a single, enforced plugin-build
 * step, a plugin source change ships/runs STALE dist from every path —
 * the release bundle, a local dev restart, and openwriter-testing. This is
 * the same stale-bundle class as the skill-bundle bug.
 *
 * Run from packages/openwriter (npm sets cwd there). Wired into the `build`
 * script and called by scripts/prepublish.cjs before it bundles.
 *
 * Plugins whose build script is plain `tsc` compile in ONE `tsc -b` run: one
 * process instead of an `npm run build` per plugin (~1.5s of npm startup each
 * on Windows), and build mode skips a plugin whose sources have not changed
 * since its last build. A release builds, then prepublish builds again; the
 * second pass costs ~0.3s instead of a full recompile, and still catches a
 * stale dist/. Any other build script runs as before.
 */
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { createHash } = require('crypto');

const pluginsRoot = path.resolve('../../plugins');
if (!fs.existsSync(pluginsRoot)) {
  console.log('[build-plugins] no plugins/ directory, nothing to build');
  process.exit(0);
}

const tscProjects = [];
const custom = [];
for (const dir of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const pluginDir = path.join(pluginsRoot, dir.name);
  const pkgPath = path.join(pluginDir, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  if (!pkg.scripts || !pkg.scripts.build) continue;
  (pkg.scripts.build.trim() === 'tsc' ? tscProjects : custom).push({ name: dir.name, pluginDir });
}

if (tscProjects.length > 0) {
  console.log(`[build-plugins] building ${tscProjects.map((p) => p.name).join(', ')}`);
  const tsc = require.resolve('typescript/bin/tsc', { paths: [process.cwd()] });
  execFileSync(process.execPath, [tsc, '-b', ...tscProjects.map((p) => p.pluginDir)], { stdio: 'inherit' });
}
// Any other build script (the publish plugin's tsc + vite) has no build mode of its own, so it
// is skipped the same way by hand: when its sources, package.json and the lockfile hash the same
// as at its last build and its dist/ is untouched since. The record lives outside dist/ so it
// never ships.
const records = path.resolve('node_modules/.cache/build-plugins');
function hashTree(root, skip) {
  const hash = createHash('sha256');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else hash.update(path.relative(root, full)).update('\0').update(fs.readFileSync(full));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return hash.digest('hex');
}
for (const { name, pluginDir } of custom) {
  const record = path.join(records, `${name}.json`);
  const inputs = hashTree(pluginDir, new Set(['dist', 'node_modules']))
    + createHash('sha256').update(fs.readFileSync(path.resolve('../../package-lock.json'))).digest('hex');
  const last = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf-8')) : null;
  if (last && last.inputs === inputs && last.output === hashTree(path.join(pluginDir, 'dist'), new Set())) {
    console.log(`[build-plugins] ${name} unchanged since its last build`);
    continue;
  }
  console.log(`[build-plugins] building ${name}`);
  execSync('npm run build', { cwd: pluginDir, stdio: 'inherit' });
  fs.mkdirSync(records, { recursive: true });
  fs.writeFileSync(record, JSON.stringify({ inputs, output: hashTree(path.join(pluginDir, 'dist'), new Set()) }) + '\n');
}
console.log(`[build-plugins] built ${tscProjects.length + custom.length} plugin(s)`);
