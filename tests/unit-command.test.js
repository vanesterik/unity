const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { unitCommand, withTestKinds } = require('../scripts/pipeline.js');

const script = path.join(__dirname, '..', 'scripts', 'pipeline.js');
const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'pipeline.json'), 'utf8'));

test('unitCommand reads the quiet unit test command', () => {
  assert.equal(unitCommand({ unit: { quietCommand: ' uv run pytest -q tests/unit ' } }), 'uv run pytest -q tests/unit');
});

test('unitCommand is null when the project has none, or left it empty', () => {
  assert.equal(unitCommand({}), null);
  assert.equal(unitCommand({ unit: {} }), null);
  assert.equal(unitCommand({ unit: { quietCommand: '  ' } }), null);
  assert.equal(unitCommand(undefined), null);
});

test('the template holds a quiet unit test command, which reads as none until /unity:init fills it in', () => {
  assert.equal(typeof template.unit.quietCommand, 'string');
  assert.equal(unitCommand(template), null);
});

test('choosing the kinds of tests keeps the unit block', () => {
  const project = { ...template, unit: { quietCommand: 'pnpm vitest run --reporter=dot' } };
  assert.deepEqual(withTestKinds(project, 'integration', template).unit, project.unit);
});

// Runs pipeline.js unit-command in a project directory with the given .claude/pipeline.json (none when null).
const run = (config) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-unit-'));
  if (config) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'pipeline.json'), JSON.stringify(config));
  }
  return spawnSync('node', [script, 'unit-command'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
};

test('pipeline.js unit-command prints the command, and nothing else', () => {
  const result = run({ unit: { quietCommand: 'cargo test --quiet' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'cargo test --quiet\n');
});

test('pipeline.js unit-command exits 1 and says what to do for a project set up before the command existed', () => {
  for (const config of [{ test: {} }, template, null]) {
    const result = run(config);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /unit\.quietCommand.*CLAUDE\.md.*\/unity:init/);
  }
});
