const test = require('node:test');
const assert = require('node:assert/strict');
const { closesIssue, latestResult, nextStep, boardWarnings } = require('../scripts/pipeline.js');

const testSummary = (status, commit) => `<!-- role:test -->\n## ✅ Test ${status} · #6 · Shout mode\n\n**Commit:** \`${commit}\` on \`feature/6-shout\``;
const reviewSummary = (verdict, commit) => `<!-- role:review -->\n## ✅ Review ${verdict} · #6 · Shout mode\n\n**Commit:** \`${commit}\` on \`feature/6-shout\``;

test('closesIssue reads the issue number from a closing keyword', () => {
  assert.equal(closesIssue('<!-- role:build -->\nCloses #6\n\n## Summary'), 6);
  assert.equal(closesIssue('fixes #12'), 12);
});

test('closesIssue returns null for a body that only mentions an issue', () => {
  assert.equal(closesIssue('See #6 for context'), null);
  assert.equal(closesIssue(null), null);
});

test('latestResult reads the newest test or review result with its status and commit', () => {
  const entries = [
    { body: testSummary('FAILURE', '5e2047c'), createdAt: '2026-11-01T10:00:00Z', url: 'u1' },
    { body: testSummary('PASS', 'abc1234'), createdAt: '2026-11-01T12:00:00Z', url: 'u2' },
    { body: '🔨 Built: pointer without a marker', createdAt: '2026-11-01T13:00:00Z', url: 'u3' },
  ];
  assert.deepEqual(latestResult(entries), { role: 'test', status: 'PASS', commit: 'abc1234', url: 'u2' });
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

test('nextStep leaves an incomplete test run on the PR head to the developer', () => {
  const issue = { number: 6, column: 'Test', pr: { headSha: 'abc1234def' }, latest: { role: 'test', status: 'INCOMPLETE', commit: 'abc1234' } };
  assert.equal(nextStep(issue), 'decide on the untested criteria');
});

test('nextStep ships an issue in Test that has no result on its PR head', () => {
  const issue = { number: 6, column: 'Test', pr: { headSha: 'fff0000aaa' }, latest: { role: 'test', status: 'INCOMPLETE', commit: 'abc1234' } };
  assert.equal(nextStep(issue), '/unity:ship 6');
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

test('boardWarnings flags an issue in Review whose test result no longer covers the PR head', () => {
  const issues = [{ number: 6, column: 'Review', pr: { number: 7 }, coverage: { covers: false, testedCommit: 'abc1234', outsideTestPaths: ['greet.js'] } }];
  const [warning] = boardWarnings({ issues, openPrs: [], mergedPrs: [], openIssues: [] });
  assert.equal(warning.type, 'stale-test');
  assert.equal(warning.issue, 6);
  assert.match(warning.message, /abc1234/);
  assert.match(warning.message, /greet\.js/);
});

test('boardWarnings flags an issue in Review without a passing test result', () => {
  const issues = [{ number: 6, column: 'Review', pr: { number: 7 }, coverage: { covers: false, testedCommit: null, outsideTestPaths: [] } }];
  const [warning] = boardWarnings({ issues, openPrs: [], mergedPrs: [], openIssues: [] });
  assert.equal(warning.type, 'stale-test');
  assert.match(warning.message, /no passing test result/);
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
