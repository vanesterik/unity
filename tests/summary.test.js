const test = require('node:test');
const assert = require('node:assert/strict');
const { runResults, formatSummary } = require('../scripts/pipeline.js');

const prBody = '<!-- role:build -->\n**Design:** v1  \n**Commits:** 3  \n**Unit tests:** 30/30 passed\n\n## Summary\n\nAdds a flag.\n\nCloses #9';
const testSummary = '<!-- role:test -->\n## ✅ Test PASS · #9 · Greet\n\n**Cases:** 8/8 passed  \n**Criteria tested:** 6/6  \n**Environment:** local  \n**Commit:** `abc1234` on `feature/9-greet`';
const review = '<!-- role:review -->\n## ✅ Review APPROVE · #9 · Greet\n\n**Criteria met:** 6/6  \n**Findings:** 0 blocking, 2 suggestions  \n**Tests run:** unit 30/30, regression 9/9  \n**Design:** v1  \n**Commit:** `abc1234` on `feature/9-greet`';
const rework = '<!-- role:build -->\n## Rework for test findings\n\n**Fixed:** 2 · **Not fixed:** 1';

const entries = [
  { source: 'pr-body', body: prBody, createdAt: '2026-11-03T10:01:00Z', url: 'p10' },
  { source: 'pr-comment', body: testSummary, createdAt: '2026-11-03T10:20:00Z', url: 'c1' },
  { source: 'pr-review', body: review, createdAt: '2026-11-03T10:30:00Z', url: 'p10' },
  { source: 'issue-comment', body: '🔨 Built: p10 (3 commits, unit tests 30/30)', createdAt: '2026-11-03T10:05:00Z', url: 'i1' },
];

test('runResults lists each role result of the run in the order they were posted', () => {
  assert.deepEqual(runResults(entries, '2026-11-03T10:00:00Z'), [
    { role: 'build', line: '🔨 Build: 3 commits, unit tests 30/30', url: 'p10' },
    { role: 'test', line: '✅ Test PASS on `abc1234`: 6/6 criteria tested, 8/8 cases passed', url: 'c1' },
    { role: 'review', line: '✅ Review APPROVE on `abc1234`: 6/6 criteria met, 0 blocking, 2 suggestions', url: 'p10' },
  ]);
});

test('runResults leaves out what was posted before the run started', () => {
  assert.deepEqual(runResults(entries, '2026-11-03T10:25:00Z').map((r) => r.role), ['review']);
});

test('runResults reports a rework instead of the older PR body', () => {
  const run = [...entries.slice(0, 1), { source: 'pr-comment', body: rework, createdAt: '2026-11-03T11:00:00Z', url: 'c2' }];
  assert.deepEqual(runResults(run, '2026-11-03T10:30:00Z'), [{ role: 'build', line: '🔨 Rework of test findings: 2 fixed, 1 not fixed', url: 'c2' }]);
});

test('runResults shows a failed test and requested changes with their counts', () => {
  const failed = testSummary.replace('✅ Test PASS', '❌ Test FAILURE').replace('8/8 passed', '6/8 passed · 2 failed');
  const changes = review.replace('✅ Review APPROVE', '❌ Review CHANGES REQUESTED').replace('0 blocking, 2 suggestions', '1 blocking, 1 suggestion');
  const results = runResults([
    { source: 'pr-comment', body: failed, createdAt: '2026-11-03T10:20:00Z', url: 'c1' },
    { source: 'pr-review', body: changes, createdAt: '2026-11-03T10:30:00Z', url: 'p10' },
  ], '2026-11-03T10:00:00Z');
  assert.equal(results[0].line, '❌ Test FAILURE on `abc1234`: 6/6 criteria tested, 6/8 cases passed');
  assert.equal(results[1].line, '❌ Review CHANGES REQUESTED on `abc1234`: 6/6 criteria met, 1 blocking, 1 suggestion');
});

test('runResults takes every result without a start time', () => {
  assert.equal(runResults(entries).length, 3);
});

test('formatSummary lists the results with their links, then the column and next step', () => {
  const summary = formatSummary({
    number: 9, title: 'Greet', pr: { number: 10 }, column: 'Review', next: 'ready to merge',
    results: runResults(entries, '2026-11-03T10:00:00Z'),
  });
  assert.equal(summary, [
    '**#9 Greet** · PR #10',
    '',
    '- 🔨 Build: 3 commits, unit tests 30/30 · p10',
    '- ✅ Test PASS on `abc1234`: 6/6 criteria tested, 8/8 cases passed · c1',
    '- ✅ Review APPROVE on `abc1234`: 6/6 criteria met, 0 blocking, 2 suggestions · p10',
    '',
    '**Column:** Review → ready to merge',
  ].join('\n'));
});

test('formatSummary says so when no role posted a result, and puts a command in backticks', () => {
  const summary = formatSummary({ number: 9, title: 'Greet', pr: null, column: 'Build', next: '/unity:ship 9', results: [] });
  assert.equal(summary, '**#9 Greet**\n\nNo role posted a result in this run.\n\n**Column:** Build → `/unity:ship 9`');
});

test('formatSummary leaves out the next step for a Done issue', () => {
  const summary = formatSummary({ number: 9, title: 'Greet', pr: null, column: 'Done', next: null, results: [] });
  assert.match(summary, /\*\*Column:\*\* Done$/);
});

// ---------- commits since the last sign-off ----------

const { changesSince, signOffs } = require('../scripts/pipeline.js');

const prCommits = [
  { sha: '2ddfc20aaaa', subject: 'feat: add --polite' },
  { sha: '3b2908baaaa', subject: 'Break the polite greeting on purpose' },
  { sha: '0ba6ef7aaaa', subject: 'test: integration coverage for #29' },
  { sha: 'eec110aaaaa', subject: 'fix: spell Good day' },
];

test('changesSince lists the commits after the last sign-off up to the commit the stopping result judged', () => {
  assert.deepEqual(changesSince({ commits: prCommits, signOffs: [{ role: 'build', commit: '2ddfc20' }], stopAt: '3b2908b' }), {
    since: { role: 'build', commit: '2ddfc20' },
    commits: [{ sha: '3b2908b', subject: 'Break the polite greeting on purpose' }],
  });
});

test('changesSince ignores a sign-off on a later commit, and takes the latest one before the stop', () => {
  const offs = [{ role: 'build', commit: '2ddfc20' }, { role: 'test', commit: '3b2908b' }, { role: 'build', commit: 'eec110a' }];
  const result = changesSince({ commits: prCommits, signOffs: offs, stopAt: '0ba6ef7' });
  assert.deepEqual(result.since, { role: 'test', commit: '3b2908b' });
  assert.deepEqual(result.commits.map((c) => c.sha), ['0ba6ef7']);
});

test('changesSince runs to the PR head without a stopping commit', () => {
  const result = changesSince({ commits: prCommits, signOffs: [{ role: 'test', commit: '3b2908b' }, { role: 'review', commit: '3b2908b' }] });
  assert.deepEqual(result.since, { role: 'review', commit: '3b2908b' });
  assert.deepEqual(result.commits.map((c) => c.sha), ['0ba6ef7', 'eec110a']);
});

test('changesSince has no commits when the stopping result judged the signed-off commit itself', () => {
  assert.deepEqual(changesSince({ commits: prCommits, signOffs: [{ role: 'build', commit: '2ddfc20' }], stopAt: '2ddfc20' }).commits, []);
});

test('changesSince lists every commit up to the stop when no role signed off', () => {
  const result = changesSince({ commits: prCommits, signOffs: [], stopAt: '3b2908b' });
  assert.equal(result.since, null);
  assert.deepEqual(result.commits.map((c) => c.sha), ['2ddfc20', '3b2908b']);
});

test('signOffs takes the build handovers, passing tests and approvals, in the order they were posted', () => {
  const body = (text, commit) => `${text}\n\n**Commit:** \`${commit}\` on \`feature/29\``;
  const offs = signOffs([
    { body: body('<!-- role:test -->\n## ❌ Test FAILURE · #29', '3b2908b'), createdAt: '2026-11-03T10:20:00Z' },
    { body: '<!-- role:build -->\n**Commits:** 1  \n**Commit:** `2ddfc20`', createdAt: '2026-11-03T10:01:00Z' },
    { body: body('<!-- role:test -->\n## ✅ Test PASS · #29', 'eec110a'), createdAt: '2026-11-03T11:20:00Z' },
    { body: body('<!-- role:review -->\n## ✅ Review APPROVE · #29', 'eec110a'), createdAt: '2026-11-03T11:30:00Z' },
    { body: body('<!-- role:review -->\n## ❌ Review CHANGES REQUESTED · #29', 'eec110a'), createdAt: '2026-11-03T11:40:00Z' },
    { body: '<!-- role:build -->\nCloses #29', createdAt: '2026-11-03T09:00:00Z' },
  ]);
  assert.deepEqual(offs, [{ role: 'build', commit: '2ddfc20' }, { role: 'test', commit: 'eec110a' }, { role: 'review', commit: 'eec110a' }]);
});

test('formatSummary shows the commits since the sign-off with their files, marking test-only ones', () => {
  const summary = formatSummary({
    number: 29, title: 'Polite greeting', pr: { number: 30 }, column: 'Build', next: '/unity:ship 29',
    results: [{ role: 'test', line: '❌ Test FAILURE on `3b2908b`: 9/9 criteria tested, 7/12 cases passed', url: 'c1' }],
    changes: { since: { role: 'build', commit: '2ddfc20' }, commits: [
      { sha: '3b2908b', subject: 'Break the polite greeting on purpose', files: ['greet.js'], testOnly: false },
      { sha: '0ba6ef7', subject: 'test: integration coverage for #29', files: ['tests/a.js', 'tests/b.js', 'tests/c.js', 'tests/d.js'], testOnly: true },
    ] },
  });
  assert.equal(summary, [
    '**#29 Polite greeting** · PR #30',
    '',
    '- ❌ Test FAILURE on `3b2908b`: 9/9 criteria tested, 7/12 cases passed · c1',
    '',
    '**Commits since the build on `2ddfc20`:**',
    '- `3b2908b` Break the polite greeting on purpose · greet.js',
    '- `0ba6ef7` test: integration coverage for #29 · tests/a.js, tests/b.js, tests/c.js and 1 more (test paths only)',
    '',
    '**Column:** Build → `/unity:ship 29`',
  ].join('\n'));
});

test('formatSummary says so when nothing landed after the sign-off, or when no role signed off', () => {
  const base = { number: 29, title: 'P', pr: { number: 30 }, column: 'Build', next: '/unity:ship 29', results: [] };
  assert.match(formatSummary({ ...base, changes: { since: { role: 'build', commit: '2ddfc20' }, commits: [] } }), /\n\n\*\*No commits since the build on `2ddfc20`\.\*\*\n\n/);
  assert.match(formatSummary({ ...base, changes: { since: null, commits: [{ sha: '2ddfc20', subject: 'feat', files: ['greet.js'], testOnly: false }] } }), /\n\n\*\*Commits, none signed off by a role:\*\*\n- `2ddfc20` feat · greet\.js\n\n/);
});
