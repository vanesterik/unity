const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'review', 'references', 'generate-review.js');

const story = {
  number: 9,
  title: 'Greet in Dutch',
  designVersion: 1,
  criteria: [{ id: 'AC1', text: 'Greets in Dutch, as @koen asked' }, { id: 'AC2', text: 'Shows the flag' }],
};

// Runs the generator on a review-data.json in a fresh directory, with the story next to it.
const generate = (data, storyData = story) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-review-'));
  const dataPath = path.join(dir, 'review-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(data));
  if (storyData) fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(storyData));
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
  criteria: [
    { id: 'AC1', where: ['greet.js:12', 'greet.js:20-22'], met: true },
    { id: 'AC2', where: ['greet.js:30'], met: true },
  ],
  blocking: [],
  suggestions: [{ title: 'Name the table', where: 'greet.js:3', body: 'A name like GREETINGS says what it holds.' }],
  strengths: 'Small, well-tested change.',
  declined: [{ behaviour: 'Greeting in French', reason: 'out of scope in the design' }],
  tests: { unit: { passed: 11, total: 11 } },
};

test('an approval is headed by the icon and the role, with Design first and Commit last', () => {
  const review = reviewFor(baseData);
  assert.match(review, /^<!-- role:review -->\n## ✅ Review\n\n\*\*Design:\*\* v1  \n\*\*Criteria met:\*\* 2\/2  \n\*\*Findings:\*\* 0 blocking, 1 suggestion  \n\*\*Tests run:\*\* unit 11\/11  \n\*\*Commit:\*\* `abc1234`\n\n/);
  assert.doesNotMatch(review, /APPROVE|#9|Greet in Dutch|feature\/9/);
});

test('the criteria table holds IDs, the wording from the design and a status icon', () => {
  const review = reviewFor(baseData);
  assert.match(review, /^\| Criterion \| Description \| Status \|$/m);
  assert.match(review, /^\| AC1 \| Greets in Dutch, as `@koen` asked \| ✅ \|$/m);
  assert.match(review, /^\| AC2 \| Shows the flag \| ✅ \|$/m);
});

test('the references per criterion follow the table, folded', () => {
  const review = reviewFor(baseData);
  assert.match(review, /\| ✅ \|\n\n<details>\n<summary>Where each criterion is met<\/summary>\n\n- \*\*AC1\*\* `greet\.js:12`, `greet\.js:20-22`\n- \*\*AC2\*\* `greet\.js:30`\n\n<\/details>\n\n### Blocking/);
});

test('the design version comes from the story, whatever the data says', () => {
  const review = reviewFor({ ...baseData, designVersion: 7 });
  assert.match(review, /^\*\*Design:\*\* v1  $/m);
});

test('a review without story.json next to it is refused', () => {
  const { result } = generate(baseData, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no story\.json/);
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
  assert.match(review, /^## ❌ Review$/m);
  assert.match(review, /^\*\*Criteria met:\*\* 1\/2  $/m);
  assert.match(review, /^\| AC2 \| Shows the flag \| ❌ \|$/m);
  assert.match(review, /^- \*\*AC2\*\* —$/m);
  assert.match(review, /^1\. \*\*Dutch ignored after --shout\*\* · `greet\.js:18`$/m);
});

test('a criterion not met without a blocking finding is refused', () => {
  const { result } = generate({ ...baseData, criteria: [baseData.criteria[0], { id: 'AC2', where: [], met: false }] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /AC2 is not met/);
});

test('a failed test run without a blocking finding is refused', () => {
  const { result } = generate({ ...baseData, tests: { unit: { passed: 10, total: 11 } } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unit tests failed/);
});

test('an integration count is refused: the reviewer does not run integration or E2E tests', () => {
  const { result } = generate({ ...baseData, tests: { unit: { passed: 11, total: 11 }, integration: { passed: 9, total: 9 } } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tests\.integration/);
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

test('a full commit SHA is shortened to 7 characters', () => {
  const review = reviewFor({ ...baseData, commit: '42b713a5f761395ecb6185adeb69b1858ffca1aa' });
  assert.match(review, /^\*\*Commit:\*\* `42b713a`$/m);
});

test('a review that leaves out the design\'s last criterion is refused', () => {
  const { result } = generate(baseData, { ...story, criteria: [...story.criteria, { id: 'AC3', text: 'Waves' }] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /design has 3 criteria and the review lists 2/);
});

test('a story without criteria is refused', () => {
  const { result } = generate(baseData, { ...story, criteria: [] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no design version or no criteria/);
});
