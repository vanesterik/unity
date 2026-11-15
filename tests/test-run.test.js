const test = require('node:test');
const assert = require('node:assert/strict');
const { shippedDesigns, lastTestRun } = require('../scripts/pipeline.js');

const design = (version, criteria) => ({
  body: `<!-- role:design v${version} -->\n## Design\n\nText.\n\n## Acceptance criteria\n${criteria.map((c, i) => `- AC${i + 1}: ${c}`).join('\n')}\n`,
  createdAt: `2026-11-0${version}T10:00:00Z`,
});

test('shippedDesigns keeps closed issues with a design, latest version and its criteria', () => {
  const issues = [
    { number: 5, title: 'Plan before buying', state: 'CLOSED', comments: [design(1, ['Old rule']), { body: 'Thanks', createdAt: '2026-11-03T10:00:00Z' }, design(2, ['A buy needs a plan', 'The refusal says so'])] },
    { number: 6, title: 'In flight', state: 'OPEN', comments: [design(1, ['Not shipped'])] },
    { number: 7, title: 'No design', state: 'CLOSED', comments: [{ body: 'Done by hand', createdAt: '2026-11-01T10:00:00Z' }] },
  ];
  assert.deepEqual(shippedDesigns(issues), [{
    number: 5,
    title: 'Plan before buying',
    version: 2,
    criteria: [{ id: 'AC1', text: 'A buy needs a plan' }, { id: 'AC2', text: 'The refusal says so' }],
  }]);
});

test('shippedDesigns sorts by issue number', () => {
  const issues = [12, 3, 8].map((number) => ({ number, title: `#${number}`, state: 'CLOSED', comments: [design(1, ['Rule'])] }));
  assert.deepEqual(shippedDesigns(issues).map((d) => d.number), [3, 8, 12]);
});

test('shippedDesigns leaves out issues closed as not planned', () => {
  const issues = [
    { number: 3, title: 'Shipped', state: 'CLOSED', stateReason: 'COMPLETED', comments: [design(1, ['Rule'])] },
    { number: 4, title: 'Abandoned', state: 'CLOSED', stateReason: 'NOT_PLANNED', comments: [design(1, ['Rule'])] },
  ];
  assert.deepEqual(shippedDesigns(issues).map((d) => d.number), [3]);
});

test('shippedDesigns with a time keeps only the issues closed since then', () => {
  const issues = [
    { number: 3, title: 'Before the last run', state: 'CLOSED', closedAt: '2026-11-04T09:00:00Z', comments: [design(1, ['Rule'])] },
    { number: 4, title: 'At the start of the last run', state: 'CLOSED', closedAt: '2026-11-05T14:32:00Z', comments: [design(1, ['Rule'])] },
    { number: 5, title: 'After it', state: 'CLOSED', closedAt: '2026-11-08T09:00:00Z', comments: [design(1, ['Rule'])] },
  ];
  assert.deepEqual(shippedDesigns(issues, '2026-11-05T14:32:00Z').map((d) => d.number), [4, 5]);
  assert.deepEqual(shippedDesigns(issues, null).map((d) => d.number), [3, 4, 5]);
});

test('lastTestRun is the start of the newest merged test run, from the stamp in its branch name', () => {
  const prs = [
    { headRefName: 'test/20261101-0800', createdAt: '2026-11-01T08:40:00Z', mergedAt: '2026-11-01T10:00:00Z' },
    { headRefName: 'test/20261105-1432', createdAt: '2026-11-05T15:10:00Z', mergedAt: '2026-11-06T09:00:00Z' },
    { headRefName: 'feature/9-greet-in-dutch', createdAt: '2026-11-07T08:00:00Z', mergedAt: '2026-11-07T09:00:00Z' },
  ];
  assert.equal(lastTestRun(prs), '2026-11-05T14:32:00Z');
});

test('lastTestRun takes the time the PR was opened for a test branch without a stamp', () => {
  assert.equal(lastTestRun([{ headRefName: 'test/epic-2', createdAt: '2026-11-05T15:10:00Z', mergedAt: '2026-11-06T09:00:00Z' }]), '2026-11-05T15:10:00Z');
});

test('lastTestRun is null before the first merged test run, so the first run reads every story', () => {
  assert.equal(lastTestRun([]), null);
  assert.equal(lastTestRun([{ headRefName: 'feature/9-greet-in-dutch', createdAt: '2026-11-07T08:00:00Z', mergedAt: '2026-11-07T09:00:00Z' }]), null);
  assert.equal(lastTestRun([{ headRefName: 'test/20261105-1432', createdAt: '2026-11-05T15:10:00Z', mergedAt: null }]), null);
});
