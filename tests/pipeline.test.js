const test = require('node:test');
const assert = require('node:assert/strict');
const { latestRoleComment, columnReport } = require('../scripts/pipeline.js');

test('latestRoleComment returns the newest comment carrying the role marker', () => {
  const entries = [
    { body: '<!-- role:test -->\nFAILURE', createdAt: '2026-11-01T10:00:00Z' },
    { body: 'Looks good to me', createdAt: '2026-11-01T12:00:00Z' },
    { body: '<!-- role:test -->\nPASS', createdAt: '2026-11-01T11:00:00Z' },
  ];
  assert.equal(latestRoleComment(entries, 'test').body, '<!-- role:test -->\nPASS');
});

test('latestRoleComment accepts a version after the role', () => {
  const entries = [{ body: '<!-- role:design v2 -->\n## Design', createdAt: '2026-11-01T10:00:00Z' }];
  assert.equal(latestRoleComment(entries, 'design').body, entries[0].body);
});

test('latestRoleComment does not match a role that only starts with the same name', () => {
  const entries = [{ body: '<!-- role:testing -->', createdAt: '2026-11-01T10:00:00Z' }];
  assert.equal(latestRoleComment(entries, 'test'), null);
});

test('latestRoleComment returns null when no comment has the marker', () => {
  assert.equal(latestRoleComment([{ body: 'hi', createdAt: '2026-11-01T10:00:00Z' }], 'review'), null);
});

test('columnReport reports a column that only differs in case or spacing as misnamed', () => {
  const report = columnReport(['Backlog', 'Build', 'Test'], ['Backlog', 'build', ' Test ']);
  assert.deepEqual(report.misnamed, [
    { expected: 'Build', found: 'build' },
    { expected: 'Test', found: ' Test ' },
  ]);
  assert.deepEqual(report.missing, []);
});

test('columnReport reports a column with no close match as missing', () => {
  const report = columnReport(['Backlog', 'Review'], ['Backlog', 'In Progress']);
  assert.deepEqual(report.missing, ['Review']);
  assert.deepEqual(report.misnamed, []);
});
