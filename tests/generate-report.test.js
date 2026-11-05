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
  designVersion: 2,
  storyName: 'Greeting CLI',
  environment: 'local checkout',
  environmentUrl: '',
  criteria: [{ id: 'AC1', text: 'An admin sees @admin next to their name' }],
  cases: [{ number: 1, name: 'Greets @koen', criteria: ['AC1'], goal: 'g', status: 'PASS', steps: ['run it'] }],
};

test('the tests are numbered, with their description, case and a status icon', () => {
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
  assert.match(summary, /^### Tests$/m);
  assert.doesNotMatch(summary, /Regression/);
  assert.match(summary, /^\| Test \| Description \| Case \| Status \|$/m);
  assert.match(summary, /^\| 1 \| Should greet a single name \| 1 \| ✅ \|$/m);
  assert.match(summary, /^\| 2 \| Should reject an empty name \| 1,&nbsp;2 \| ❌ \|$/m);
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
  assert.equal(summary.match(/#\d+/g), null); // not even the issue: the sidebar shows it
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

test('an exploratory criterion is not counted as an acceptance criterion', () => {
  const { dir, result } = generate({
    ...baseData,
    criteria: [...baseData.criteria, { id: 'X', text: 'Exploratory checks beyond the acceptance criteria' }],
    cases: [...baseData.cases, { number: 2, name: 'Repeated flag', criteria: ['X'], goal: 'g', status: 'PASS', steps: ['run it'] }],
  });
  assert.equal(result.status, 0, result.stderr);
  const summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /^\*\*Criteria tested:\*\* 1\/1 · 1 exploratory case  $/m);
  assert.match(summary, /^\| X \| Exploratory checks beyond the acceptance criteria \| 2 \| ✅ \|$/m);
  const output = JSON.parse(result.stdout);
  assert.equal(output.coveredCriteria, 1);
  assert.equal(output.totalCriteria, 1);
});

test('without exploratory cases the criteria line has only the count', () => {
  assert.match(summaryFor(baseData), /^\*\*Criteria tested:\*\* 1\/1  $/m);
});

test('the heading is the outcome icon and the role, with Design first and Commit last', () => {
  const summary = summaryFor(baseData);
  assert.match(summary, /^<!-- role:test -->\n## ✅ Test\n\n\*\*Design:\*\* v2  \n\*\*Cases:\*\* 1\/1 passed  \n\*\*Criteria tested:\*\* 1\/1  \n\*\*Environment:\*\* local checkout  \n\*\*Commit:\*\* `dc1ad16`\n\n/);
  assert.doesNotMatch(summary, /PASS|Greeting CLI|feature\/4/);
});

test('a failed or incomplete run is headed by its own icon', () => {
  const failed = summaryFor({ ...baseData, cases: [{ ...baseData.cases[0], status: 'FAIL', expected: 'a', actual: 'b' }] });
  assert.match(failed, /^## ❌ Test$/m);
  const incomplete = summaryFor({ ...baseData, criteria: [...baseData.criteria, { id: 'AC2', text: 'Untested' }] });
  assert.match(incomplete, /^## ⚠️ Test$/m);
});

test('the criteria and cases tables share the tests table structure', () => {
  const summary = summaryFor(baseData);
  assert.match(summary, /^\| Criterion \| Description \| Cases \| Status \|$/m);
  assert.match(summary, /^\| Case \| Description \| Criteria \| Status \|$/m);
});

test('without an issue, as when run on its own, the Design field is left out', () => {
  const { designVersion, issue, ...standalone } = baseData;
  assert.match(summaryFor(standalone), /^## ✅ Test\n\n\*\*Cases:\*\*/m);
});

test('the design version comes from story.json next to the report data when the data leaves it out', () => {
  const { designVersion, ...data } = baseData;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-report-'));
  fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify({ number: 4, designVersion: 3 }));
  fs.writeFileSync(path.join(dir, 'report-data.json'), JSON.stringify(data));
  const result = spawnSync('node', [generator, path.join(dir, 'report-data.json')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /^\*\*Design:\*\* v3  $/m);
});

test('a report for an issue without any design version is refused, so its post never lacks the Design field', () => {
  const { designVersion, ...data } = baseData;
  const { result } = generate(data);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /design version/);
});
