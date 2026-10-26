// Type-check the plugins whose build does not: a plugin's `typecheck` script (the publish
// plugin's screens, bundled by vite, which strips types without checking them). Kept out of
// the build so a release does not pay for it on every build pass; run by `npm test` and CI.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const plugins = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins');
let failed = false;
for (const name of readdirSync(plugins)) {
  const pkgPath = join(plugins, name, 'package.json');
  if (!existsSync(pkgPath) || !JSON.parse(readFileSync(pkgPath, 'utf8')).scripts?.typecheck) continue;
  try {
    execSync('npm run typecheck', { cwd: join(plugins, name), stdio: 'inherit' });
  } catch {
    console.error(`${name}: type errors`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
