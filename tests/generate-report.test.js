const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'test-user-story', 'references', 'generate-report.js');

// Runs the generator on a report-data.json in a fresh directory and returns summary.md.
const summaryFor = (data) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-report-'));
  const dataPath = path.join(dir, 'report-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(data));
  const result = spawnSync('node', [generator, dataPath], { encoding: 'utf8' });
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

test('scripted tests are rendered as a table with tags split from the title', () => {
  const summary = summaryFor({
    ...baseData,
    e2eTests: [{ file: 'tests/integration/greet.js', title: '@issue-4 @AC1 Should greet a single name', status: 'passing' }],
  });
  assert.match(summary, /^\| Test \| Tags \| File \| Status \|$/m);
  assert.match(summary, /^\| Should greet a single name \| `@issue-4` `@AC1` \| `tests\/integration\/greet\.js` \| passing \|$/m);
});

test('the summary contains no bare @mentions', () => {
  const summary = summaryFor({
    ...baseData,
    e2eTests: [{ file: 'tests/integration/greet.js', title: '@AC1 Should greet', status: 'passing' }],
  });
  const outsideCode = summary.replace(/`[^`\n]*`/g, '');
  assert.doesNotMatch(outsideCode, /(^|[^\w])@[A-Za-z0-9]/m);
  assert.match(summary, /`@admin`/);
  assert.match(summary, /`@koen`/);
});

test('an email address is left as it is', () => {
  const summary = summaryFor({ ...baseData, criteria: [{ id: 'AC1', text: 'Mail goes to info@example.com' }] });
  assert.match(summary, /Mail goes to info@example\.com/);
});
