#!/usr/bin/env node
// PreToolUse guard for /unity:test. Active only while a test run is in progress,
// which the tester agent signals by writing artifacts/.test-active in the project.
// While active, Edit/Write/MultiEdit outside test.writablePaths (.claude/pipeline.json) is blocked (exit 2).
// This is a guardrail, not a sandbox: shell commands are not intercepted.
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const marker = path.join(root, 'artifacts', '.test-active');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  if (!fs.existsSync(marker)) process.exit(0); // not in a test run: allow everything

  let filePath;
  try {
    const event = JSON.parse(input || '{}');
    filePath = event.tool_input && (event.tool_input.file_path || event.tool_input.path);
  } catch { process.exit(0); }
  if (!filePath) process.exit(0);

  // The project's test paths, or the template's when the project has none.
  const writablePaths = (file) => {
    try {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      return config.test && Array.isArray(config.test.writablePaths) ? config.test.writablePaths : null;
    } catch { return null; }
  };
  const allowed = writablePaths(path.join(root, '.claude', 'pipeline.json'))
    || writablePaths(path.join(__dirname, '..', 'templates', 'pipeline.json'));

  const { outsidePaths } = require('../scripts/pipeline.js');
  const relative = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  if (!outsidePaths([relative], allowed).length) process.exit(0);

  console.error(
    `A /unity:test run is active: it may not modify ${relative}.\n` +
    `/unity:test writes only to: ${allowed.join(', ')}.\n` +
    'If the application is wrong, keep the failing test and file a new story for it with pipeline.js new-story.\n' +
    '(No test run in progress? A previous run did not clean up: delete artifacts/.test-active.)'
  );
  process.exit(2);
});
