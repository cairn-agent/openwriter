import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(msg: string): void {
  console.error(msg);
}

function getGlobalVersion(): string | null {
  try {
    return execSync('openwriter --version', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).toString().trim();
  } catch {
    return null;
  }
}

function getLatestVersion(): string | null {
  try {
    return execSync('npm view openwriter version', {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    }).toString().trim();
  } catch {
    return null;
  }
}

function installOrUpdateGlobally(): boolean {
  log('\n② Installing/updating openwriter globally...');

  // Try without sudo first (works on Windows, nvm, Homebrew, volta, etc.)
  try {
    execSync('npm install -g openwriter@latest', { stdio: 'inherit', timeout: 120000 });
    log('  ✓ Installed globally');
    return true;
  } catch {
    // Likely permission error on macOS/Linux system Node
  }

  // Try with sudo on non-Windows (only if we have a TTY for password prompt)
  if (process.platform !== 'win32' && process.stdin.isTTY) {
    log('  Retrying with sudo...');
    try {
      execSync('sudo npm install -g openwriter@latest', { stdio: 'inherit', timeout: 120000 });
      log('  ✓ Installed globally (sudo)');
      return true;
    } catch {
      // sudo failed too
    }
  }

  log('  ✗ Could not install globally (permissions)');
  return false;
}

function isMcpConfigured(): boolean {
  const claudeJson = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(claudeJson)) return false;
  try {
    const content = JSON.parse(fs.readFileSync(claudeJson, 'utf-8'));
    return !!content?.mcpServers?.openwriter;
  } catch {
    return false;
  }
}

function configureMcp(useNpx: boolean): boolean {
  log('\n③ Configuring MCP server for Claude Code...');

  const mcpCommand = useNpx ? 'npx' : 'openwriter';
  const mcpArgs = useNpx ? ['-y', 'openwriter', '--no-open'] : ['--no-open'];

  // Try using claude CLI
  const cliArgs = useNpx
    ? 'claude mcp add -s user openwriter -- npx -y openwriter --no-open'
    : 'claude mcp add -s user openwriter -- openwriter --no-open';
  try {
    execSync(cliArgs, {
      stdio: 'inherit',
      timeout: 15000,
    });
    log('  ✓ MCP server configured');
    return true;
  } catch {
    // claude CLI not available or failed
  }

  // Fallback: edit ~/.claude.json directly
  log('  claude CLI not found — writing config directly...');
  const claudeJson = path.join(os.homedir(), '.claude.json');
  try {
    let config: any = {};
    if (fs.existsSync(claudeJson)) {
      config = JSON.parse(fs.readFileSync(claudeJson, 'utf-8'));
    }
    if (!config.mcpServers) config.mcpServers = {};

    // Add openwriter as first entry (Claude Code loads sequentially)
    const existing = config.mcpServers;
    config.mcpServers = {
      openwriter: { command: mcpCommand, args: mcpArgs },
      ...existing,
    };

    fs.writeFileSync(claudeJson, JSON.stringify(config, null, 2), 'utf-8');
    log(`  ✓ MCP server added to ${claudeJson}`);
    return true;
  } catch (err) {
    log(`  ✗ Could not configure MCP server. Add manually:`);
    log('    claude mcp add -s user openwriter -- openwriter --no-open');
    return false;
  }
}

/**
 * `openwriter setup`: install the package, register the MCP server with Claude Code and add the
 * background subagents. No skill: the tools, server instructions and the guidance that arrives
 * with each document carry what an agent needs. adr: adr/in-system-guidance.md
 */
export function runSetup(): void {
  // Step 1: Install custom Claude Code subagents to ~/.claude/agents/. These have
  // allowlist-restricted tools so the main agent can dispatch them without
  // loading the full MCP tool registry into the subagent's context
  // (~50K tokens of overhead avoided per spawn).
  log('① Installing OpenWriter background agents...');
  const agentsSource = path.join(__dirname, '../../agents');
  const agentsTarget = path.join(os.homedir(), '.claude', 'agents');
  fs.mkdirSync(agentsTarget, { recursive: true });
  for (const file of fs.readdirSync(agentsSource)) {
    if (!file.endsWith('.md')) continue;
    fs.copyFileSync(path.join(agentsSource, file), path.join(agentsTarget, file));
    log(`  ✓ Subagent installed: ${file}`);
  }

  // Earlier versions copied an OpenWriter skill here. It is retired and the copy
  // goes stale, so remove the copy setup made, recognised by its repository line.
  const oldSkill = path.join(os.homedir(), '.claude', 'skills', 'openwriter');
  const oldSkillFile = path.join(oldSkill, 'SKILL.md');
  if (fs.existsSync(oldSkillFile) && fs.readFileSync(oldSkillFile, 'utf-8').includes('repository: https://github.com/travsteward/openwriter')) {
    fs.rmSync(oldSkill, { recursive: true, force: true });
    log(`  ✓ Removed the retired OpenWriter skill from ${oldSkill}`);
  }

  // Step 2: Global install or update
  let useNpx = false;
  const currentVersion = getGlobalVersion();
  const latestVersion = getLatestVersion();

  if (currentVersion && latestVersion && currentVersion === latestVersion) {
    log(`\n② openwriter v${currentVersion} is up to date — skipping`);
  } else {
    if (currentVersion && latestVersion) {
      log(`\n② Updating openwriter: v${currentVersion} → v${latestVersion}`);
    }
    if (!installOrUpdateGlobally()) {
      // Global install/update failed (permissions) — fall back to npx
      log('  → Will use npx fallback for MCP server (no global install needed)');
      useNpx = true;
    }
  }

  // Step 3: Configure MCP server
  if (isMcpConfigured() && !useNpx) {
    log('\n③ MCP server already configured — skipping');
  } else {
    configureMcp(useNpx);
  }

  // Done
  log('\n✓ OpenWriter is ready!');
  log('  Restart Claude Code, then ask it to write something in OpenWriter.');
  log('  Your documents open at http://localhost:5050.\n');
  process.exit(0);
}
