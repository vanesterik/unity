const test = require('node:test');
const assert = require('node:assert/strict');
const { closesIssue, latestResult, nextStep, boardWarnings, boardColumns, columnReport, COLUMNS } = require('../scripts/pipeline.js');

const ICON = { PASS: '✅', FAILURE: '❌', INCOMPLETE: '⚠️', APPROVE: '✅', 'CHANGES REQUESTED': '❌' };
const testSummary = (status, commit) => `<!-- role:test -->\n## ${ICON[status]} Test\n\n**Commit:** \`${commit}\``;
const reviewSummary = (verdict, commit) => `<!-- role:review -->\n## ${ICON[verdict]} Review\n\n**Commit:** \`${commit}\``;

test('closesIssue reads the issue number from a closing keyword', () => {
  assert.equal(closesIssue('<!-- role:build -->\nCloses #6\n\n## Summary'), 6);
  assert.equal(closesIssue('fixes #12'), 12);
});

test('closesIssue returns null for a body that only mentions an issue', () => {
  assert.equal(closesIssue('See #6 for context'), null);
  assert.equal(closesIssue(null), null);
});

test('latestResult reads the newest review result with its status and commit', () => {
  const entries = [
    { body: reviewSummary('CHANGES REQUESTED', '5e2047c'), createdAt: '2026-11-01T10:00:00Z', url: 'u1' },
    { body: reviewSummary('APPROVE', 'abc1234'), createdAt: '2026-11-01T12:00:00Z', url: 'u2' },
    { body: '🔨 Built: pointer without a marker', createdAt: '2026-11-01T13:00:00Z', url: 'u3' },
  ];
  assert.deepEqual(latestResult(entries), { role: 'review', status: 'APPROVE', commit: 'abc1234', url: 'u2' });
});

test('latestResult ignores an old test result on the PR', () => {
  const entries = [
    { body: reviewSummary('CHANGES REQUESTED', '5e2047c'), createdAt: '2026-11-01T10:00:00Z', url: 'u1' },
    { body: testSummary('PASS', 'abc1234'), createdAt: '2026-11-01T12:00:00Z', url: 'u2' },
  ];
  assert.deepEqual(latestResult(entries), { role: 'review', status: 'CHANGES REQUESTED', commit: '5e2047c', url: 'u1' });
});

test('latestResult reads a two-word review verdict', () => {
  const entries = [{ body: reviewSummary('CHANGES REQUESTED', 'abc1234'), createdAt: '2026-11-01T10:00:00Z', url: 'u1' }];
  assert.equal(latestResult(entries).status, 'CHANGES REQUESTED');
});

test('latestResult falls back to the build result when nothing was tested yet', () => {
  const entries = [{ body: '<!-- role:build -->\nCloses #6', createdAt: '2026-11-01T10:00:00Z', url: 'u1' }];
  assert.deepEqual(latestResult(entries), { role: 'build', status: null, commit: null, url: 'u1' });
});

test('latestResult returns null without any role output', () => {
  assert.equal(latestResult([{ body: 'hi', createdAt: '2026-11-01T10:00:00Z' }]), null);
});

test('nextStep sends Backlog and Design issues to design', () => {
  assert.equal(nextStep({ number: 3, column: 'Backlog' }), '/unity:design 3');
  assert.equal(nextStep({ number: 3, column: 'Design' }), '/unity:design 3');
});

test('nextStep ships an issue in Build', () => {
  assert.equal(nextStep({ number: 6, column: 'Build' }), '/unity:ship 6');
});

test('nextStep marks an approval of the PR head as ready to merge', () => {
  const issue = { number: 6, column: 'Review', pr: { headSha: 'abc1234def' }, latest: { role: 'review', status: 'APPROVE', commit: 'abc1234' } };
  assert.equal(nextStep(issue), 'ready to merge');
});

test('nextStep ships an issue in Review whose approval is for an older commit', () => {
  const issue = { number: 6, column: 'Review', pr: { headSha: 'fff0000aaa' }, latest: { role: 'review', status: 'APPROVE', commit: 'abc1234' } };
  assert.equal(nextStep(issue), '/unity:ship 6');
});

test('nextStep has nothing for a Done issue', () => {
  assert.equal(nextStep({ number: 6, column: 'Done' }), null);
});

test('boardWarnings flags an open PR that closes no issue on the board', () => {
  const issues = [{ number: 6, column: 'Build' }];
  const openPrs = [
    { number: 7, url: 'p7', body: 'Closes #6' },
    { number: 8, url: 'p8', body: 'Bump a dependency' },
    { number: 9, url: 'p9', body: 'Closes #40' },
  ];
  const warnings = boardWarnings({ issues, openPrs, mergedPrs: [], openIssues: [] });
  assert.deepEqual(warnings.map((w) => [w.type, w.pr]), [['pr-without-issue', 8], ['pr-without-issue', 9]]);
  assert.match(warnings[1].message, /#40/);
});

test('boardWarnings does not flag the open PR of a test run', () => {
  const openPrs = [{ number: 30, url: 'p30', headRefName: 'test/20261109-1400', body: 'Suite trimmed, no closing keyword' }];
  assert.deepEqual(boardWarnings({ issues: [], openPrs, mergedPrs: [], openIssues: [] }), []);
});

test('boardWarnings flags an open issue whose closing PR is merged, naming the PR', () => {
  const mergedPrs = [{ number: 10, url: 'https://github.com/o/r/pull/10', body: 'Closes #9' }, { number: 11, url: 'p11', body: 'Closes #5' }];
  const openIssues = [{ number: 9, title: 'Greet in Dutch' }];
  const [warning, extra] = boardWarnings({ issues: [], openPrs: [], mergedPrs, openIssues });
  assert.equal(extra, undefined);
  assert.equal(warning.type, 'merged-but-open');
  assert.equal(warning.issue, 9);
  assert.equal(warning.pr, 10);
  assert.match(warning.message, /pull\/10/);
});

const { formatBoard } = require('../scripts/pipeline.js');

const overview = {
  columns: [
    { name: 'Backlog', issues: [{ number: 17, title: 'Guest checkout', next: '/unity:design 17' }] },
    { name: 'Design', issues: [] },
    { name: 'Build', issues: [{ number: 18, title: 'Greeting count', pr: { number: 20, draft: true }, latest: { role: 'build', status: null, commit: null }, next: '/unity:ship 18' }] },
    { name: 'Review', issues: [
      { number: 15, title: 'Custom greeting word', pr: { number: 16, draft: false }, latest: { role: 'review', status: 'APPROVE', commit: '6e43f62' }, next: 'ready to merge' },
      { number: 23, title: 'Version flag', pr: { number: 24, draft: false }, latest: null, next: '/unity:ship 23' },
    ] },
    { name: 'Done', issues: [{ number: 1 }, { number: 2 }] },
  ],
  warnings: [],
};

test('formatBoard lists each column with issues, its result and next step', () => {
  assert.equal(formatBoard(overview), [
    '**Backlog** (1)',
    '- #17 Guest checkout → `/unity:design 17`',
    '',
    '**Build** (1)',
    '- #18 Greeting count · PR #20 (draft) · 🔨 Built → `/unity:ship 18`',
    '',
    '**Review** (2)',
    '- #15 Custom greeting word · PR #16 · ✅ Review APPROVE on `6e43f62` → ready to merge',
    '- #23 Version flag · PR #24 · no result yet → `/unity:ship 23`',
    '',
    'Empty: Design · Done: 2',
  ].join('\n'));
});

test('formatBoard marks requested changes with a cross', () => {
  const failing = { columns: [{ name: 'Build', issues: [
    { number: 8, title: 'B', pr: { number: 9 }, latest: { role: 'review', status: 'CHANGES REQUESTED', commit: 'abc1234' }, next: '/unity:ship 8' },
  ] }], warnings: [] };
  const lines = formatBoard(failing).split('\n');
  assert.equal(lines[1], '- #8 B · PR #9 · ❌ Review CHANGES REQUESTED on `abc1234` → `/unity:ship 8`');
});

test('formatBoard says so when the board has no open work', () => {
  const empty = { columns: [{ name: 'Backlog', issues: [] }, { name: 'Done', issues: [{ number: 1 }] }], warnings: [] };
  assert.equal(formatBoard(empty), 'Nothing in progress.\n\nEmpty: Backlog · Done: 1');
});

test('formatBoard ends with the warnings, and how to close a merged-but-open issue', () => {
  const warned = { columns: [{ name: 'Done', issues: [] }], warnings: [
    { type: 'pr-without-issue', pr: 21, message: 'PR #21 closes no issue: p21' },
    { type: 'merged-but-open', issue: 19, pr: 22, message: '#19 is still open, but PR #22 that closes it is merged: p22' },
  ] };
  assert.equal(formatBoard(warned), [
    'Nothing in progress.',
    '',
    'Done: 0',
    '',
    '**Warnings**',
    '- ⚠️ PR #21 closes no issue: p21',
    '- ⚠️ #19 is still open, but PR #22 that closes it is merged: p22',
    '',
    'Close #19 by hand, with a comment saying which pull request delivered it and how each acceptance criterion was met.',
  ].join('\n'));
});

test('the board lists an issue in a column unity no longer uses', () => {
  const issues = [
    { number: 4, title: 'Left in Test', column: 'Test' },
    { number: 5, title: 'In Review', column: 'Review' },
    { number: 6, title: 'Nowhere', column: null },
  ];
  assert.deepEqual(boardColumns(issues).map((c) => [c.name, c.issues.map((i) => i.number)]), [
    ['Backlog', []], ['Design', []], ['Build', []], ['Review', [5]], ['Done', []], ['Test', [4]], ['No column', [6]],
  ]);
});

test('columnReport does not ask for a Test column, and does not mind one', () => {
  assert.deepEqual(COLUMNS, ['Backlog', 'Design', 'Build', 'Review', 'Done']);
  assert.deepEqual(columnReport(COLUMNS, ['Backlog', 'Design', 'Build', 'Test', 'Review', 'Done']), { missing: [], misnamed: [] });
});
