#!/usr/bin/env node
// PreToolUse guard for the QA role. Active only while a QA run is in progress,
// which /agent-team:qa signals by writing ai-evidence/.qa-active in the project.
// While active, Edit/Write/MultiEdit outside qa.writablePaths (.claude/pipeline.json) is blocked (exit 2).
// This is a guardrail, not a sandbox: shell commands are not intercepted.
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const marker = path.join(root, 'ai-evidence', '.qa-active');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (!fs.existsSync(marker)) process.exit(0); // not in a QA run: allow everything

  let filePath;
  try {
    const event = JSON.parse(input || '{}');
    filePath = event.tool_input && (event.tool_input.file_path || event.tool_input.path);
  } catch { process.exit(0); }
  if (!filePath) process.exit(0);

  let allowed = ['e2e/', 'tests/integration/', 'ai-evidence/'];
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'pipeline.json'), 'utf8'));
    if (config.qa && Array.isArray(config.qa.writablePaths)) allowed = config.qa.writablePaths;
  } catch { /* defaults */ }

  const relative = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  const inside = allowed.some((prefix) => {
    const clean = prefix.replace(/\/$/, '');
    return relative === clean || relative.startsWith(`${clean}/`);
  });
  if (inside) process.exit(0);

  const issue = fs.readFileSync(marker, 'utf8').trim();
  console.error(
    `QA run${issue ? ` for #${issue}` : ''} is active: QA may not modify ${relative}.\n` +
    `QA writes only to: ${allowed.join(', ')}.\n` +
    'If the application is wrong, keep the failing test, record the failure in report-data.json, and send the issue back to Building.\n' +
    '(No QA run in progress? A previous run did not clean up: delete ai-evidence/.qa-active.)'
  );
  process.exit(2);
});
