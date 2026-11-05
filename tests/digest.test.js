const test = require('node:test');
const assert = require('node:assert/strict');
const { allRunResults, formatDigest } = require('../scripts/pipeline.js');

const merged = [
  { number: 7, title: 'Generate the PR body', pr: { number: 31 }, range: { first: 'a1b2c3d'.padEnd(40, '0'), last: 'e4f5a6b'.padEnd(40, '0'), count: 4 }, issueClosed: true },
  { number: 10, title: 'Add a board overview', pr: { number: 32 }, range: { first: 'f7a8b9c'.padEnd(40, '0'), last: 'd0e1f2a'.padEnd(40, '0'), count: 1 }, issueClosed: true },
];

const stopped = {
  number: 8,
  title: 'Write the summary',
  pr: { number: 33 },
  results: [
    { role: 'build', line: '🔨 Build: 3 commits, unit tests 30/30', url: 'u1' },
    { role: 'test', line: '❌ Test FAILURE on `c3d4e5f`', url: 'u2' },
  ],
  report: '/repo/artifacts/8-summary/index.html',
  column: 'Build',
  next: '/unity:ship 8',
};

test('formatDigest for a run that emptied the queue', () => {
  assert.equal(formatDigest({ merged, stopped: null, waiting: [], blocked: [] }), [
    '**Autopilot · 2 merged**',
    '**Merged**\n- **#7 Generate the PR body** · PR #31 · `a1b2c3d..e4f5a6b` (4 commits)\n- **#10 Add a board overview** · PR #32 · `f7a8b9c..d0e1f2a` (1 commit)',
  ].join('\n\n'));
});

test('formatDigest for a run that stopped', () => {
  assert.equal(formatDigest({ merged, stopped, waiting: [{ number: 9, title: 'Generate the design' }], blocked: [] }), [
    '**Autopilot · 2 merged, stopped at #8 · 1 waiting**',
    '**Merged**\n- **#7 Generate the PR body** · PR #31 · `a1b2c3d..e4f5a6b` (4 commits)\n- **#10 Add a board overview** · PR #32 · `f7a8b9c..d0e1f2a` (1 commit)',
    '**Stopped at #8 Write the summary** · PR #33\n- 🔨 Build: 3 commits, unit tests 30/30 · u1\n- ❌ Test FAILURE on `c3d4e5f` · u2',
    '**Test report:** `/repo/artifacts/8-summary/index.html`',
    '**Column:** Build → `/unity:ship 8`',
    '**Still waiting in Build:** #9 Generate the design',
  ].join('\n\n'));
});

test('formatDigest for a run that stopped at its first story', () => {
  const text = formatDigest({ merged: [], stopped: { ...stopped, report: null, pr: null }, waiting: [], blocked: [] });
  assert.equal(text.split('\n\n')[0], '**Autopilot · nothing merged, stopped at #8**');
  assert.ok(text.includes('**Stopped at #8 Write the summary**\n'));
  assert.ok(!text.includes('Test report'));
  assert.ok(!text.includes('Still waiting'));
});

test('formatDigest when nothing was in Build', () => {
  assert.equal(formatDigest({ merged: [], stopped: null, waiting: [], blocked: [] }), '**Autopilot · nothing merged, Build is empty**');
});

test('formatDigest when a stopped story blocks the run', () => {
  assert.equal(formatDigest({ merged: [], stopped: null, waiting: [{ number: 9, title: 'Generate the design' }], blocked: [{ number: 8, title: 'Write the summary', column: 'Test' }] }), [
    '**Autopilot · nothing started: #8 Write the summary is still stopped in Test**',
    '**Still waiting in Build:** #9 Generate the design',
  ].join('\n\n'));
  assert.equal(formatDigest({ merged: [], stopped: null, waiting: [], blocked: [{ number: 8, title: 'T', column: null }] }), '**Autopilot · nothing started: #8 T is still stopped, not on the board**');
});

test('formatDigest marks a merged story whose issue is still open', () => {
  const text = formatDigest({ merged: [{ ...merged[0], issueClosed: false }], stopped: null, waiting: [], blocked: [] });
  assert.ok(text.endsWith('(4 commits) · issue still open'));
});

test('formatDigest without a range', () => {
  const text = formatDigest({ merged: [{ ...merged[0], range: null }], stopped: null, waiting: [], blocked: [] });
  assert.ok(text.endsWith('· PR #31 · commits not found on main'));
});

const prBody = '<!-- role:build -->\n**Design:** v1  \n**Commits:** 3  \n**Unit tests:** 30/30 passed\n\nCloses #8';
const failed = '<!-- role:test -->\n## ❌ Test FAILURE · #8 · T\n\n**Cases:** 6/8 passed · 2 failed  \n**Criteria tested:** 6/6  \n**Commit:** `c3d4e5f` on `feature/8-t`';
const rework = '<!-- role:build -->\n## Rework for test findings\n\n**Fixed:** 2 · **Not fixed:** 0';
const passed = '<!-- role:test -->\n## ✅ Test PASS · #8 · T\n\n**Cases:** 8/8 passed  \n**Criteria tested:** 6/6  \n**Commit:** `a9b8c7d` on `feature/8-t`';
const approve = '<!-- role:review -->\n## ✅ Review APPROVE · #8 · T\n\n**Criteria met:** 6/6  \n**Findings:** 0 blocking, 0 suggestions  \n**Commit:** `a9b8c7d` on `feature/8-t`';

test('allRunResults lists every result of the run, reworks included', () => {
  const entries = [
    { body: approve, createdAt: '2026-11-05T11:40:00Z', url: 'r1' },
    { body: prBody, createdAt: '2026-11-05T10:05:00Z', url: 'p1' },
    { body: failed, createdAt: '2026-11-05T10:30:00Z', url: 't1' },
    { body: rework, createdAt: '2026-11-05T11:00:00Z', url: 'w1' },
    { body: passed, createdAt: '2026-11-05T11:20:00Z', url: 't2' },
    { body: 'plain comment', createdAt: '2026-11-05T11:21:00Z', url: 'x' },
  ];
  assert.deepEqual(allRunResults(entries, '2026-11-05T10:00:00Z').map((r) => [r.role, r.url]), [
    ['build', 'p1'], ['test', 't1'], ['build', 'w1'], ['test', 't2'], ['review', 'r1'],
  ]);
  assert.deepEqual(allRunResults(entries, '2026-11-05T11:10:00Z').map((r) => r.url), ['t2', 'r1']);
});

const { mergedSince } = require('../scripts/pipeline.js');

test('mergedSince keeps the PRs merged during the run that close an issue, oldest first', () => {
  const prs = [
    { number: 33, body: 'Closes #9', mergedAt: '2026-11-05T12:00:00Z' },
    { number: 30, body: 'Closes #6', mergedAt: '2026-11-04T12:00:00Z' },
    { number: 31, body: 'Closes #7', mergedAt: '2026-11-05T11:00:00Z' },
    { number: 32, body: 'no keyword', mergedAt: '2026-11-05T11:30:00Z' },
  ];
  assert.deepEqual(mergedSince(prs, '2026-11-05T10:00:00Z').map((p) => [p.number, p.issue]), [[31, 7], [33, 9]]);
});
