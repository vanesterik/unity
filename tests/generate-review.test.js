const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'review', 'references', 'generate-review.js');

// Runs the generator on a review-data.json in a fresh directory.
const generate = (data) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-review-'));
  const dataPath = path.join(dir, 'review-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(data));
  return { dir, result: spawnSync('node', [generator, dataPath], { encoding: 'utf8' }) };
};

const reviewFor = (data) => {
  const { dir, result } = generate(data);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'review.md'), 'utf8');
};

const baseData = {
  issue: { number: 9, title: 'Greet in Dutch' },
  branch: 'feature/9-greet-in-dutch',
  commit: 'abc1234',
  designVersion: 1,
  designCriteria: 2,
  criteria: [
    { id: 'AC1', where: ['greet.js:12', 'greet.js:20-22'], met: true },
    { id: 'AC2', where: ['greet.js:30'], met: true },
  ],
  blocking: [],
  suggestions: [{ title: 'Name the table', where: 'greet.js:3', body: 'A name like GREETINGS says what it holds.' }],
  strengths: 'Small, well-tested change.',
  declined: [{ behaviour: 'Greeting in French', reason: 'out of scope in the design' }],
  tests: { unit: { passed: 11, total: 11 }, regression: { passed: 9, total: 9 } },
};

test('an approval has the same header shape as the test summary', () => {
  const review = reviewFor(baseData);
  assert.match(review, /^<!-- role:review -->\n## ✅ Review APPROVE · #9 · Greet in Dutch\n\n/);
  assert.match(review, /^\*\*Criteria met:\*\* 2\/2  $/m);
  assert.match(review, /^\*\*Findings:\*\* 0 blocking, 1 suggestion  $/m);
  assert.match(review, /^\*\*Tests run:\*\* unit 11\/11, regression 9\/9  $/m);
  assert.match(review, /^\*\*Design:\*\* v1  $/m);
  assert.match(review, /^\*\*Commit:\*\* `abc1234` on `feature\/9-greet-in-dutch`$/m);
});

test('the criteria table holds IDs, references and a status icon', () => {
  const review = reviewFor(baseData);
  assert.match(review, /^\| Criterion \| Where \| Status \|$/m);
  assert.match(review, /^\| AC1 \| `greet\.js:12`, `greet\.js:20-22` \| ✅ \|$/m);
});

test('a blocking finding makes the verdict CHANGES REQUESTED, whatever the input says', () => {
  const { dir, result } = generate({
    ...baseData,
    verdict: 'APPROVE',
    criteria: [baseData.criteria[0], { id: 'AC2', where: [], met: false }],
    blocking: [{ title: 'Dutch ignored after --shout', where: 'greet.js:18', body: 'Run `--shout --lang nl Koen`: prints HELLO.' }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /ignored; computed CHANGES REQUESTED/);
  const review = fs.readFileSync(path.join(dir, 'review.md'), 'utf8');
  assert.match(review, /^## ❌ Review CHANGES REQUESTED · #9/m);
  assert.match(review, /^\*\*Criteria met:\*\* 1\/2  $/m);
  assert.match(review, /^\| AC2 \| — \| ❌ \|$/m);
  assert.match(review, /^1\. \*\*Dutch ignored after --shout\*\* · `greet\.js:18`$/m);
});

test('a criterion not met without a blocking finding is refused', () => {
  const { result } = generate({ ...baseData, criteria: [baseData.criteria[0], { id: 'AC2', where: [], met: false }] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AC2 is not met/);
});

test('a failed test run without a blocking finding is refused', () => {
  const { result } = generate({ ...baseData, tests: { ...baseData.tests, regression: { passed: 8, total: 9 } } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regression tests failed/);
});

test('criteria with a gap in their numbering are refused', () => {
  const { result } = generate({ ...baseData, criteria: [baseData.criteria[0], { ...baseData.criteria[1], id: 'AC3' }] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected AC2/);
});

test('a Where holding an explanation instead of a reference is refused', () => {
  const { result } = generate({ ...baseData, criteria: [{ id: 'AC1', where: ['greet.js:12 reads the flag'], met: true }, baseData.criteria[1]] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /file:line/);
});

test('empty sections say None and @words are wrapped in backticks', () => {
  const review = reviewFor({ ...baseData, suggestions: [], declined: [], strengths: 'Tags like @AC1 are on every test.' });
  assert.match(review, /### Suggestions\n\nNone\./);
  assert.match(review, /### Declined to judge\n\nNone\./);
  assert.match(review, /Tags like `@AC1` are on every test\./);
});

test('a full commit SHA is shortened to 7 characters, as in the test summary', () => {
  const review = reviewFor({ ...baseData, commit: '42b713a5f761395ecb6185adeb69b1858ffca1aa' });
  assert.match(review, /^\*\*Commit:\*\* `42b713a` on `feature\/9-greet-in-dutch`$/m);
});

test('a review that leaves out the design\'s last criterion is refused', () => {
  const { result } = generate({ ...baseData, designCriteria: 3 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /design has 3 criteria/);
});

test('a review without the design\'s criterion count is refused', () => {
  const { designCriteria, ...data } = baseData;
  const { result } = generate(data);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /designCriteria/);
});
