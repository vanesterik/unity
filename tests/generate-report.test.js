const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'test-user-story', 'references', 'generate-report.js');

// Runs the generator on a report-data.json in a fresh directory.
const generate = (data) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-report-'));
  const dataPath = path.join(dir, 'report-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(data));
  return { dir, result: spawnSync('node', [generator, dataPath], { encoding: 'utf8' }) };
};

const summaryFor = (data) => {
  const { dir, result } = generate(data);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
};

const baseData = {
  issue: { number: 4, title: 'Greeting CLI', url: 'https://github.com/o/r/issues/4' },
  branch: 'feature/4-greeting-cli',
  commit: 'dc1ad16',
  storyName: 'Greeting CLI',
  environment: 'local checkout',
  environmentUrl: '',
  criteria: [{ id: 'AC1', text: 'An admin sees @admin next to their name' }],
  cases: [{ number: 1, name: 'Greets @koen', criteria: ['AC1'], goal: 'g', status: 'PASS', steps: ['run it'] }],
};

test('regression tests are a table of test, case, criteria and a status icon', () => {
  const summary = summaryFor({
    ...baseData,
    cases: [
      { number: 1, name: 'Greets', criteria: ['AC1'], goal: 'g', status: 'PASS', steps: ['run it'] },
      { number: 2, name: 'Rejects', criteria: ['AC1'], goal: 'g', status: 'FAIL', steps: ['run it'], expected: 'usage line', actual: 'nothing' },
    ],
    regressionStability: '5 isolated and 3 parallel runs',
    e2eTests: [
      { file: 'tests/integration/greet.js', title: '@issue-4 @AC1 Should greet a single name', cases: [1], status: 'passing (5/5 runs)' },
      { file: 'tests/integration/reject.js', title: '@issue-4 @AC1 Should reject an empty name', cases: [1, 2], status: 'failing: application bug, see case 2' },
    ],
  });
  assert.match(summary, /^### Regression tests$/m);
  assert.match(summary, /^\| Test \| Case \| Criteria \| Status \|$/m);
  assert.match(summary, /^\| Should greet a single name \| 1 \| AC1 \| ✅ \|$/m);
  assert.match(summary, /^\| Should reject an empty name \| 1,&nbsp;2 \| AC1 \| ❌ \|$/m);
  assert.match(summary, /^In `tests\/integration\/greet\.js`, `tests\/integration\/reject\.js`\. Stable over 5 isolated and 3 parallel runs\.$/m);
  assert.doesNotMatch(summary, /issue-4/);
});

test('a regression test pointing at an unknown case is refused', () => {
  const { result } = generate({
    ...baseData,
    e2eTests: [{ file: 'tests/integration/greet.js', title: '@AC1 Should greet', cases: [7], status: 'passing' }],
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /case 7/);
});

test('the summary contains no bare @mentions', () => {
  const summary = summaryFor({
    ...baseData,
    e2eTests: [{ file: 'tests/integration/greet.js', title: '@AC1 Should greet', cases: [1], status: 'passing' }],
  });
  const outsideCode = summary.replace(/`[^`\n]*`/g, '');
  assert.doesNotMatch(outsideCode, /(^|[^\w])@[A-Za-z0-9]/m);
  assert.match(summary, /`@admin`/);
  assert.match(summary, /`@koen`/);
});

test('case numbers carry no # so GitHub does not link them to issues', () => {
  const summary = summaryFor({
    ...baseData,
    cases: [
      { number: 1, name: 'Greets', criteria: ['AC1'], goal: 'g', status: 'PASS', steps: ['run it'], flaky: 'timed out once' },
      { number: 2, name: 'Rejects', criteria: ['AC1'], goal: 'g', status: 'FAIL', steps: ['run it'], expected: 'usage line', actual: 'nothing' },
    ],
  });
  assert.match(summary, /^\| AC1 \| .* \| 1,&nbsp;2 \| ❌ \|$/m);
  assert.match(summary, /\*\*Case 2: Rejects\*\*/);
  assert.match(summary, /^- Case 1: Greets/m);
  assert.deepEqual(summary.match(/#\d+/g), ['#4']); // only the issue itself
});

test('statuses in the criteria and cases tables are icons', () => {
  const summary = summaryFor({
    ...baseData,
    criteria: [{ id: 'AC1', text: 'Greets' }, { id: 'AC2', text: 'Rejects' }, { id: 'AC3', text: 'Sends an email' }],
    cases: [
      { number: 1, name: 'Greets', criteria: ['AC1'], goal: 'g', status: 'PASS', steps: ['run it'] },
      { number: 2, name: 'Rejects', criteria: ['AC2'], goal: 'g', status: 'FAIL', steps: ['run it'], expected: 'usage line', actual: 'nothing' },
      { number: 3, name: 'Mail', criteria: ['AC3'], goal: 'g', status: 'SKIPPED', steps: ['n/a'] },
    ],
  });
  assert.match(summary, /^\| AC1 \| Greets \| 1 \| ✅ \|$/m);
  assert.match(summary, /^\| AC2 \| Rejects \| 2 \| ❌ \|$/m);
  assert.match(summary, /^\| AC3 \| Sends an email \| 3 \| ⚠️ \|$/m);
  assert.match(summary, /^\| 1 \| Greets \| AC1 \| ✅ \|$/m);
  assert.match(summary, /^\| 2 \| Rejects \| AC2 \| ❌ \|$/m);
  assert.match(summary, /^\| 3 \| Mail \| AC3 \| ⚠️ \|$/m);
});

test('an email address is left as it is', () => {
  const summary = summaryFor({ ...baseData, criteria: [{ id: 'AC1', text: 'Mail goes to info@example.com' }] });
  assert.match(summary, /Mail goes to info@example\.com/);
});

test('an environment without a URL is shown without empty parentheses', () => {
  const summary = summaryFor({ ...baseData, environment: 'local checkout', environmentUrl: '' });
  assert.match(summary, /^\*\*Environment:\*\* local checkout  $/m);
});

test('an environment with a URL shows it in parentheses', () => {
  const summary = summaryFor({ ...baseData, environment: 'local', environmentUrl: 'http://localhost:4009' });
  assert.match(summary, /^\*\*Environment:\*\* local \(http:\/\/localhost:4009\)  $/m);
});
