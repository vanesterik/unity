const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'build', 'references', 'generate-build.js');

const git = (cwd, args) => {
  const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

// A repository with main and a feature branch holding the given commits, oldest first.
const repoWith = (subjects) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-build-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'Initial commit']);
  git(dir, ['checkout', '-q', '-b', 'feature/9-greet-in-dutch']);
  for (const subject of subjects) git(dir, ['commit', '-q', '--allow-empty', '-m', subject]);
  return dir;
};

const story = {
  number: 9,
  title: 'Greet in Dutch',
  designVersion: 2,
  criteria: [{ id: 'AC1', text: 'Greets in Dutch' }, { id: 'AC2', text: 'Shows the flag' }],
};

const baseData = {
  summary: 'Adds a `--dutch` flag to the greeting CLI.',
  criteria: [
    { id: 'AC1', implemented: ['greet.js greet()'], unitTests: ['test/greet.test.js greets in Dutch'] },
    { id: 'AC2', implemented: ['greet.js flag()'], unitTests: [] },
  ],
  deviations: [{ ruling: 'Lowercase flag only', reason: 'The design names no other spelling', cost: 'a user typing --Dutch gets an error' }],
  run: ['node greet.js --dutch Koen'],
  unitTests: { command: 'npm test', passed: 12, total: 12, output: '# tests 12\n# pass 12' },
};

// Runs the generator on a data file in a fresh artifacts directory, from inside the repository.
const generate = (data, { repo = repoWith(['Add the Dutch greeting', 'Add the flag']), storyData = story, name = 'build-data.json' } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-build-artifacts-'));
  const dataPath = path.join(dir, name);
  fs.writeFileSync(dataPath, JSON.stringify(data));
  if (storyData) fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(storyData));
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

test('the PR body starts with the marker and the closing keyword, then the counts', () => {
  const body = bodyFor(baseData);
  assert.match(body, /^<!-- role:build -->\nCloses #9\n\n/);
  assert.match(body, /^\*\*Design:\*\* v2  $/m);
  assert.match(body, /^\*\*Commits:\*\* 2  $/m);
  assert.match(body, /^\*\*Unit tests:\*\* 12\/12 passed$/m);
});

test('the commit list comes from git, oldest first, whatever the data says', () => {
  const repo = repoWith(['Add the Dutch greeting', 'Add the flag', 'test: e2e coverage for #9 (AC1, AC2)']);
  const shas = git(repo, ['log', '--reverse', '--format=%h', 'main..HEAD']).split('\n');
  const body = bodyFor({ ...baseData, commits: ['made up'] }, { repo });
  assert.match(body, new RegExp(`## Review commit by commit\\n\\n1\\. \`${shas[0]}\` Add the Dutch greeting\\n2\\. \`${shas[1]}\` Add the flag\\n3\\. \`${shas[2]}\` test: e2e coverage for #9 \\(AC1, AC2\\)\\n`));
  assert.match(body, /^\*\*Commits:\*\* 3  $/m);
});

test('the criteria table puts each place and test in backticks, and hands an untested criterion to the test role', () => {
  const body = bodyFor(baseData);
  assert.match(body, /^\| Criterion \| Implemented in \| Unit tests \|$/m);
  assert.match(body, /^\| AC1 \| `greet\.js greet\(\)` \| `test\/greet\.test\.js greets in Dutch` \|$/m);
  assert.match(body, /^\| AC2 \| `greet\.js flag\(\)` \| verified by the test role \|$/m);
});

test('the deviations, the run commands and the unit test output each get their section', () => {
  const body = bodyFor(baseData);
  assert.match(body, /## Deviations from the design\n\n- \*\*Lowercase flag only\.\*\* The design names no other spelling\. If wrong: a user typing --Dutch gets an error\.\n/);
  assert.match(body, /## How to run it\n\n```bash\nnode greet\.js --dutch Koen\n```\n/);
  assert.match(body, /## Unit tests\n\n`npm test`\n\n```\n# tests 12\n# pass 12\n```\n$/);
});

test('no deviations reads as None', () => {
  const body = bodyFor({ ...baseData, deviations: [] });
  assert.match(body, /## Deviations from the design\n\nNone\.\n/);
});

test('an @word in the prose is wrapped in backticks, so GitHub mentions nobody', () => {
  const body = bodyFor({ ...baseData, summary: 'Tagged as @AC1 in the tests.' });
  assert.match(body, /## Summary\n\nTagged as `@AC1` in the tests\.\n/);
});

test('it refuses data that leaves out a criterion of the design', () => {
  const stderr = refusal({ ...baseData, criteria: [baseData.criteria[0]] });
  assert.match(stderr, /the design has AC1, AC2; the data has AC1/);
});

test('it refuses a criterion the design does not have', () => {
  const stderr = refusal({ ...baseData, criteria: [...baseData.criteria, { id: 'AC3', implemented: ['x.js'], unitTests: [] }] });
  assert.match(stderr, /the design has AC1, AC2; the data has AC1, AC2, AC3/);
});

test('it refuses a criterion without the code that implements it', () => {
  const stderr = refusal({ ...baseData, criteria: [baseData.criteria[0], { id: 'AC2', implemented: [], unitTests: [] }] });
  assert.match(stderr, /AC2 needs "implemented"/);
});

test('it refuses a red unit test suite', () => {
  const stderr = refusal({ ...baseData, unitTests: { ...baseData.unitTests, passed: 11 } });
  assert.match(stderr, /11\/12 unit tests passed/);
});

test('it refuses to run without the story next to the data', () => {
  const stderr = refusal(baseData, { storyData: null });
  assert.match(stderr, /story\.json/);
});

test('it refuses a branch without commits', () => {
  const stderr = refusal(baseData, { repo: repoWith([]) });
  assert.match(stderr, /no commits on this branch/);
});

test('it prints the counts and the path it wrote as JSON', () => {
  const { dir, result } = generate(baseData);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { body: path.join(dir, 'pr-body.md'), commits: 2, criteria: 2, unitTests: { passed: 12, total: 12 } });
});
