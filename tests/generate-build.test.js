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

const headSha = (repo) => git(repo, ['rev-parse', '--short', 'HEAD']);

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
  unitTests: { passed: 12, total: 12 },
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

test('the PR body starts with the marker and the counts, then the summary and the closing keyword', () => {
  const body = bodyFor(baseData);
  assert.match(body, /^<!-- role:build -->\n\*\*Design:\*\* v2  \n\*\*Commits:\*\* 2  \n\*\*Unit tests:\*\* 12\/12 passed  \n\*\*Commit:\*\* `[0-9a-f]{7}`\n\n## Summary\n\nAdds a `--dutch` flag to the greeting CLI\.\n\nCloses #9\n\n## Acceptance criteria\n/);
});

test('the PR body names the commit the builder handed over, the branch head', () => {
  const repo = repoWith(['Add the Dutch greeting', 'Add the flag']);
  const body = bodyFor(baseData, { repo });
  assert.match(body, new RegExp(`^\\*\\*Commit:\\*\\* \`${headSha(repo)}\`$`, 'm'));
});

test('the commit count comes from git, whatever the data says, and the commits are not listed', () => {
  const repo = repoWith(['Add the Dutch greeting', 'Add the flag', 'test: e2e coverage for #9 (AC1, AC2)']);
  const body = bodyFor({ ...baseData, commits: 7 }, { repo });
  assert.match(body, /^\*\*Commits:\*\* 3  $/m);
  assert.doesNotMatch(body, /Review commit by commit|Add the flag/);
});

test('the criteria table puts each place and test in backticks, and leaves an untested criterion to the next /unity:test', () => {
  const body = bodyFor(baseData);
  assert.match(body, /^\| Criterion \| Implemented in \| Unit tests \|$/m);
  assert.match(body, /^\| AC1 \| `greet\.js greet\(\)` \| `test\/greet\.test\.js greets in Dutch` \|$/m);
  assert.match(body, /^\| AC2 \| `greet\.js flag\(\)` \| covered by the next \/unity:test \|$/m);
});

test('the deviations and the run commands each get their section, which end the body', () => {
  const body = bodyFor(baseData);
  assert.match(body, /## Deviations from the design\n\n- \*\*Lowercase flag only\.\*\* The design names no other spelling\. If wrong: a user typing --Dutch gets an error\.\n/);
  assert.match(body, /## How to run it\n\n```bash\nnode greet\.js --dutch Koen\n```\n$/);
  assert.doesNotMatch(body, /## Unit tests/);
});

test('without deviations the section is left out', () => {
  const body = bodyFor({ ...baseData, deviations: [] });
  assert.doesNotMatch(body, /Deviations from the design/);
  assert.match(body, /\| AC2 \| `greet\.js flag\(\)` \| covered by the next \/unity:test \|\n\n## How to run it\n/);
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

// ---------- rework comment ----------

const reworkRepo = () => repoWith(['Add the Dutch greeting', 'Validate the name before greeting']);

const reworkFor = (repo, findings, rework = 'review', storyData = story) => {
  const { dir, result } = generate({ rework, findings }, { repo, name: 'rework-data.json', storyData });
  return { dir, result, comment: result.status === 0 ? fs.readFileSync(path.join(dir, 'rework.md'), 'utf8') : null };
};

test('a rework comment is headed Rework, with Design first, whose findings it reworks, the counts and Commit last', () => {
  const repo = reworkRepo();
  const { comment } = reworkFor(repo, [{ finding: 'Case 2: an empty name greets nobody', fix: 'Validate the name', commit: headSha(repo), proof: 'unit test "rejects an empty name"' }], 'review');
  assert.match(comment, new RegExp(`^<!-- role:build -->\\n## Rework\\n\\n\\*\\*Design:\\*\\* v2  \\n\\*\\*Findings of:\\*\\* review  \\n\\*\\*Fixed:\\*\\* 1  \\n\\*\\*Not fixed:\\*\\* 0  \\n\\*\\*Commit:\\*\\* \`${headSha(repo)}\`\\n\\n`));
});

test('a rework needs story.json for the design version', () => {
  const { result } = reworkFor(reworkRepo(), [{ finding: 'Case 2', disagree: 'no' }], 'review', null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /story\.json/);
});

test('a rework row holds the fix with its proof, its commit and a status; a disagreement says why, without a commit', () => {
  const repo = reworkRepo();
  const sha = headSha(repo);
  const { comment } = reworkFor(repo, [
    { finding: 'Case 2: an empty name greets nobody', fix: 'Validate the name', commit: sha, proof: 'unit test "rejects an empty name"' },
    { finding: 'Case 5: the greeting is not bold', disagree: 'The design asks for plain text' },
  ]);
  assert.match(comment, /^\| Finding \| Fix \| Commit \| Status \|$/m);
  assert.match(comment, new RegExp(`^\\| Case 2: an empty name greets nobody \\| Validate the name\\. Proof: unit test "rejects an empty name"\\. \\| \`${sha}\` \\| ✅ \\|$`, 'm'));
  assert.match(comment, /^\| Case 5: the greeting is not bold \| The design asks for plain text\. \| — \| ❌ \|$/m);
  assert.match(comment, /\*\*Fixed:\*\* 1  \n\*\*Not fixed:\*\* 1  /);
});

test('it refuses a fix whose commit is not on the branch', () => {
  const { result } = reworkFor(reworkRepo(), [{ finding: 'Case 2', fix: 'Validate', commit: 'deadbee', proof: 'unit test' }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deadbee is not a commit on this branch/);
});

test('it refuses a finding with neither a fix nor a disagreement', () => {
  const { result } = reworkFor(reworkRepo(), [{ finding: 'Case 2' }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /findings 1 needs "fix", "commit" and "proof", or "disagree"/);
});

test('it refuses a rework that is not of review findings', () => {
  for (const role of ['design', 'test']) {
    const { result } = reworkFor(reworkRepo(), [{ finding: 'Case 2', disagree: 'no' }], role);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /"rework" must be "review"/);
  }
});

test('a rework prints its counts and the path it wrote as JSON', () => {
  const repo = reworkRepo();
  const { dir, result } = reworkFor(repo, [{ finding: 'Case 2', fix: 'Validate', commit: headSha(repo), proof: 'unit test' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { comment: path.join(dir, 'rework.md'), rework: 'review', fixed: 1, notFixed: 0 });
});
