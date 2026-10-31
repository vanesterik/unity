#!/usr/bin/env node
// Deterministic part of /unity:init: puts the per-project files in place.
// Idempotent: never overwrites existing files, only adds what's missing.
//
//   node "${CLAUDE_SKILL_DIR}/../../scripts/init-project.js" [--check]
//
// --check only reports what would change.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pluginRoot = path.resolve(__dirname, '..');
const templates = path.join(pluginRoot, 'templates');
const checkOnly = process.argv.includes('--check');

const projectRoot = () => {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
};
const root = projectRoot();

const plugin = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(path.join(pluginRoot, '.claude-plugin', 'marketplace.json'), 'utf8'));
const repoMatch = String(plugin.repository || '').match(/github\.com[/:]([^/]+\/[^/.]+)/);

const changes = [];
const write = (relative, content, note) => {
  changes.push({ file: relative, action: note });
  if (checkOnly) return;
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const read = (relative) => {
  const target = path.join(root, relative);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
};

// 1. .claude/pipeline.json (board IDs are filled in afterwards by `pipeline.js init`)
if (read('.claude/pipeline.json') === null) {
  write('.claude/pipeline.json', fs.readFileSync(path.join(templates, 'pipeline.json'), 'utf8'), 'created from template');
}

// 2. environments.json
if (read('environments.json') === null) {
  write('environments.json', fs.readFileSync(path.join(templates, 'environments.json'), 'utf8'), 'created from template');
}

// 3. CLAUDE.md workflow section
const section = fs.readFileSync(path.join(templates, 'CLAUDE.workflow.md'), 'utf8');
const claudeMd = read('CLAUDE.md');
if (claudeMd === null) {
  write('CLAUDE.md', `# ${path.basename(root)}\n\n${section}`, 'created with workflow section');
} else if (!claudeMd.includes('<!-- unity:workflow:start -->')) {
  write('CLAUDE.md', `${claudeMd.replace(/\s*$/, '')}\n\n${section}`, 'workflow section appended');
}

// 4. .gitignore
const gitignore = read('.gitignore');
if (gitignore === null || !gitignore.split(/\r?\n/).some((line) => line.trim().replace(/^\//, '') === 'ai-evidence/')) {
  const base = gitignore === null ? '' : `${gitignore.replace(/\s*$/, '')}\n`;
  write('.gitignore', `${base}\n# unity QA evidence (local only)\nai-evidence/\n`, gitignore === null ? 'created' : 'ai-evidence/ added');
}

// 5. .claude/settings.json: register the marketplace and enable the plugin for this repo
const settingsRaw = read('.claude/settings.json');
let settings = {};
try { settings = settingsRaw ? JSON.parse(settingsRaw) : {}; } catch {
  console.error('.claude/settings.json is not valid JSON; left untouched. Add the unity entries by hand.');
  settings = null;
}
if (settings) {
  const pluginKey = `${plugin.name}@${marketplace.name}`;
  let changed = false;
  if (repoMatch) {
    settings.extraKnownMarketplaces = settings.extraKnownMarketplaces || {};
    if (!settings.extraKnownMarketplaces[marketplace.name]) {
      settings.extraKnownMarketplaces[marketplace.name] = { source: { source: 'github', repo: repoMatch[1] }, autoUpdate: true };
      changed = true;
    }
  }
  settings.enabledPlugins = settings.enabledPlugins || {};
  if (settings.enabledPlugins[pluginKey] !== true) {
    settings.enabledPlugins[pluginKey] = true;
    changed = true;
  }
  if (changed) write('.claude/settings.json', `${JSON.stringify(settings, null, 2)}\n`, settingsRaw ? 'plugin enabled (merged)' : 'created, plugin enabled');
}

console.log(JSON.stringify({ projectRoot: root, checkOnly, changes }, null, 2));
