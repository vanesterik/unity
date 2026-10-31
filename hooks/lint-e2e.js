#!/usr/bin/env node
// PostToolUse hook, after Tim Lolkema's lint-e2e.sh: when an E2E file is edited, run the
// project's E2E linter and turn lint errors (exit 1) into a blocking hook error (exit 2),
// so the agent has to fix them before continuing.
// Configured per project in .claude/pipeline.json: e2e.dir and e2e.lintCommand.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let config;
  try { config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'pipeline.json'), 'utf8')); } catch { process.exit(0); }
  const e2e = config.e2e || {};
  if (!e2e.lintCommand || !e2e.dir) process.exit(0);

  let filePath;
  try {
    const event = JSON.parse(input || '{}');
    filePath = event.tool_input && (event.tool_input.file_path || event.tool_input.path);
  } catch { process.exit(0); }
  if (!filePath) process.exit(0);

  const relative = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  const dir = e2e.dir.replace(/\/$/, '');
  if (!(relative === dir || relative.startsWith(`${dir}/`))) process.exit(0); // only lint E2E files

  const result = spawnSync(e2e.lintCommand, { cwd: root, shell: true, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  if (result.status === 0) process.exit(0);
  if (output) console.error(output);
  process.exit(result.status === 1 ? 2 : (result.status ?? 1));
});
