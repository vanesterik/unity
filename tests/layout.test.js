const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewVerdict, reworkOf, latestResult, signOffs, runResults, reworksSince, formatPointer } = require('../scripts/pipeline.js');

const testPost = (icon) => `<!-- role:test -->\n## ${icon} Test\n\n**Design:** v1  \n**Cases:** 5/5 passed  \n**Criteria tested:** 4/4  \n**Environment:** local  \n**Commit:** \`adcc769\``;
const reviewPost = (icon) => `<!-- role:review -->\n## ${icon} Review\n\n**Design:** v1  \n**Criteria met:** 4/4  \n**Findings:** 0 blocking, 2 suggestions  \n**Tests run:** unit 62/62, integration 99/99  \n**Commit:** \`71a3e37\``;
const reworkPost = (role) => `<!-- role:build -->\n## Rework\n\n**Design:** v1  \n**Findings of:** ${role}  \n**Fixed:** 2  \n**Not fixed:** 1  \n**Commit:** \`9f3c2a1\``;

test('reviewVerdict reads the verdict from the heading icon', () => {
  assert.equal(reviewVerdict(reviewPost('✅')), 'APPROVE');
  assert.equal(reviewVerdict(reviewPost('❌')), 'CHANGES REQUESTED');
  assert.equal(reviewVerdict(testPost('✅')), null);
});

test('reworkOf reads whose findings a rework answers, and its counts', () => {
  assert.deepEqual(reworkOf(reworkPost('review')), { role: 'review', fixed: 2, notFixed: 1 });
  assert.equal(reworkOf(testPost('✅')), null);
});

test('reworkOf no longer accepts test findings', () => {
  assert.deepEqual(reworkOf(reworkPost('test')), { role: null, fixed: 2, notFixed: 1 });
});

test('latestResult and signOffs read the new headings, and skip old test posts', () => {
  const entries = [
    { body: testPost('✅'), createdAt: '2026-11-05T10:00:00Z', url: 't' },
    { body: reviewPost('✅'), createdAt: '2026-11-05T10:10:00Z', url: 'r' },
  ];
  assert.deepEqual(latestResult(entries), { role: 'review', status: 'APPROVE', commit: '71a3e37', url: 'r' });
  assert.deepEqual(signOffs(entries), [{ role: 'review', commit: '71a3e37' }]);
});

test('the summaries keep their words, read from the new layout', () => {
  const results = runResults([
    { body: reworkPost('review'), createdAt: '2026-11-05T09:00:00Z', url: 'w' },
    { body: testPost('✅'), createdAt: '2026-11-05T10:00:00Z', url: 't' },
    { body: reviewPost('❌'), createdAt: '2026-11-05T10:10:00Z', url: 'r' },
  ], '2026-11-05T08:00:00Z');
  assert.deepEqual(results.map((r) => r.line), [
    '🔨 Rework of review findings: 2 fixed, 1 not fixed',
    '❌ Review CHANGES REQUESTED on `71a3e37`: 4/4 criteria met, 0 blocking, 2 suggestions',
  ]);
  assert.equal(formatPointer('review', { body: reviewPost('✅'), url: 'r' }), '✅ Review APPROVE: r');
});

test('a rework in the new layout counts toward the rework limit', () => {
  assert.equal(reworksSince([{ body: reworkPost('review'), createdAt: '2026-11-05T10:00:00Z' }], '2026-11-05T09:00:00Z'), 1);
});

test('a rework post without a known role has no pointer', () => {
  assert.throws(() => formatPointer('build', { body: '<!-- role:build -->\n## Rework\n\n**Fixed:** 1', url: 'w' }), /Findings of/);
});
