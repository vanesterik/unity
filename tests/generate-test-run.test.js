const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'test', 'references', 'generate-test-run.js');

const git = (cwd, args) => {
  const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

// A repository with main and a test-run branch holding the given commits, oldest first.
const repoWith = (subjects) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-test-run-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'Initial commit']);
  git(dir, ['checkout', '-q', '-b', 'test/20261109-1400']);
  for (const subject of subjects) git(dir, ['commit', '-q', '--allow-empty', '-m', subject]);
  return dir;
};

const passing = {
  kinds: ['integration'],
  flows: [{ name: 'analysis → plan → settle', issues: [143, 148], tests: ['tests/integration/plan-flow.test.ts'] }],
  suite: { before: 264, after: 18 },
  changes: [
    { action: 'deleted', file: 'tests/integration/old.test.ts', reason: 'repeats the unit tests of #120' },
    { action: 'added', file: 'tests/integration/plan-flow.test.ts', reason: 'the plan flow across #143 and #148' },
  ],
  run: { passed: 18, total: 18 },
  failing: [],
  stories: [],
};

const failing = {
  ...passing,
  run: { passed: 17, total: 18 },
  failing: [{ test: 'tests/integration/plan-flow.test.ts > settles a plan', story: 160 }],
  stories: [{ number: 160, title: 'Settling a plan ignores dividends in cash' }],
};

const generate = (data, { repo = repoWith(['Delete tests that repeat the unit tests', 'Add the plan flow']) } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-test-run-artifacts-'));
  const dataPath = path.join(dir, 'test-run.json');
  fs.writeFileSync(dataPath, JSON.stringify(data));
  return { dir, repo, result: spawnSync('node', [generator, dataPath], { cwd: repo, encoding: 'utf8' }) };
};

const bodyFor = (data, options) => {
  const { dir, result } = generate(data, options);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'pr-body.md'), 'utf8');
};

const refusal = (data, options) => {
  const { result } = generate(data, options);
  assert.notEqual(result.status, 0);
  return result.stderr;
};

test('the body starts with the marker and a ✅ Test heading when every test passed', () => {
  const lines = bodyFor(passing).split('\n');
  assert.equal(lines[0], '<!-- unity:test-run -->');
  assert.equal(lines[1], '## ✅ Test');
});

test('a failing test makes the heading ❌ Test', () => {
  assert.match(bodyFor(failing), /^## ❌ Test$/m);
});

test('the fields give the suite before and after, the run and the new stories', () => {
  const body = bodyFor(failing);
  assert.match(body, /^\*\*Suite:\*\* 264 → 18 tests/m);
  assert.match(body, /^\*\*Run:\*\* 17\/18 passed/m);
  assert.match(body, /^\*\*New stories:\*\* #160/m);
  assert.match(bodyFor(passing), /^\*\*New stories:\*\* none/m);
});

test('flows, changes and failing tests each get a table', () => {
  const body = bodyFor(failing);
  assert.match(body, /## Flows\n\n\| Flow \| Stories \| Tests \|\n\| --- \| --- \| --- \|\n\| analysis → plan → settle \| #143, #148 \| `tests\/integration\/plan-flow.test.ts` \|/);
  assert.match(body, /## Changes\n\n\| Change \| File \| Why \|\n\| --- \| --- \| --- \|\n\| deleted \| `tests\/integration\/old.test.ts` \| repeats the unit tests of #120 \|/);
  assert.match(body, /## Failing\n\n\| Test \| Story \|\n\| --- \| --- \|\n\| `tests\/integration\/plan-flow.test.ts > settles a plan` \| #160 Settling a plan ignores dividends in cash \|/);
  assert.doesNotMatch(bodyFor(passing), /## Failing/);
});

test('the commits since main are listed under "Review commit by commit", with Commit as the last field', () => {
  const repo = repoWith(['Delete tests that repeat the unit tests', 'Add the plan flow']);
  const body = bodyFor({ ...passing, commits: ['made up'] }, { repo });
  assert.match(body, /## Review commit by commit\n\n1\. Delete tests that repeat the unit tests\n2\. Add the plan flow\n/);
  assert.doesNotMatch(body, /made up/);
  const fields = body.split('\n\n')[1].split('\n');
  assert.equal(fields[fields.length - 1], `**Commit:** \`${git(repo, ['rev-parse', '--short', 'HEAD'])}\``);
});

test('it refuses a failing count that does not match the run', () => {
  assert.match(refusal({ ...failing, run: { passed: 16, total: 18 } }), /failing/);
});

test('it refuses a failing test whose story is not among the new stories', () => {
  assert.match(refusal({ ...failing, stories: [] }), /story/);
});

test('it refuses more passed than run', () => {
  assert.match(refusal({ ...passing, run: { passed: 19, total: 18 } }), /run/);
});

test('it refuses an unknown change', () => {
  assert.match(refusal({ ...passing, changes: [{ action: 'moved', file: 'a.test.ts', reason: 'x' }] }), /action/);
});

test('it refuses a branch without commits', () => {
  assert.match(refusal(passing, { repo: repoWith([]) }), /commit/);
});

test('@words are wrapped in backticks', () => {
  const body = bodyFor({ ...passing, changes: [{ action: 'rewritten', file: 'a.test.ts', reason: 'the rule of @AC2 changed' }] });
  assert.match(body, /the rule of `@AC2` changed/);
});

test('it prints the path, the run and the stories as JSON', () => {
  const { dir, result } = generate(failing);
  assert.deepEqual(JSON.parse(result.stdout), { path: path.join(dir, 'pr-body.md'), passed: 17, total: 18, stories: [160] });
});

test('it refuses a failing test without a story number, and a story without a number', () => {
  assert.match(refusal({ ...failing, failing: [{ test: 'x' }], stories: [{ title: 'No number' }] }), /story/);
  assert.match(refusal({ ...passing, stories: [{ title: 'No number' }] }), /number/);
});

test('it refuses a change without a file', () => {
  assert.match(refusal({ ...passing, changes: [{ action: 'added', reason: 'x' }] }), /file/);
});

test('a closing keyword in the prose is defused, so merging the test run closes no issue', () => {
  const body = bodyFor({
    ...failing,
    changes: [{ action: 'rewritten', file: 'a.test.ts', reason: 'resolves #7 check' }],
    stories: [{ number: 160, title: 'Rounding fixes #12 wrongly' }],
  });
  assert.doesNotMatch(body, /(closes|fixes|resolves) #\d/i);
  assert.match(body, /resolves `#7`/);
  assert.match(body, /fixes `#12` wrongly/);
});
