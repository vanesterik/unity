const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPointer } = require('../scripts/pipeline.js');

const prBody = '<!-- role:build -->\n**Design:** v1  \n**Commits:** 3  \n**Unit tests:** 30/30 passed\n\n## Summary\n\nAdds a flag.\n\nCloses #9';

test('the build pointer links the PR with its commit and unit test counts from the body', () => {
  const entry = { source: 'pr-body', body: prBody, url: 'https://github.com/o/r/pull/10' };
  assert.equal(formatPointer('build', entry), '🔨 Built: https://github.com/o/r/pull/10 (3 commits, unit tests 30/30)');
});

test('the build pointer says commit for a single one', () => {
  const entry = { source: 'pr-body', body: prBody.replace('**Commits:** 3', '**Commits:** 1'), url: 'p10' };
  assert.equal(formatPointer('build', entry), '🔨 Built: p10 (1 commit, unit tests 30/30)');
});

test('after a rework the build pointer links the rework comment', () => {
  const entry = { source: 'pr-comment', body: '<!-- role:build -->\n## Rework\n\n**Findings of:** review  \n**Fixed:** 2  \n**Not fixed:** 0', url: 'c1' };
  assert.equal(formatPointer('build', entry), '🔨 Reworked review findings: c1');
});

test('a PR body without the generated counts has no pointer', () => {
  assert.throws(() => formatPointer('build', { source: 'pr-body', body: '<!-- role:build -->\nCloses #9', url: 'p10' }), /generate-build\.js/);
});

test('the test pointer carries the icon, the status and the tested commit', () => {
  const icon = { PASS: '✅', FAILURE: '❌', INCOMPLETE: '⚠️' };
  const body = (status) => `<!-- role:test -->\n## ${icon[status]} Test\n\n**Commit:** \`abc1234\``;
  assert.equal(formatPointer('test', { body: body('PASS'), url: 'c2' }), '✅ Test PASS on `abc1234`: c2');
  assert.equal(formatPointer('test', { body: body('FAILURE'), url: 'c2' }), '❌ Test FAILURE on `abc1234`: c2');
  assert.equal(formatPointer('test', { body: body('INCOMPLETE'), url: 'c2' }), '⚠️ Test INCOMPLETE on `abc1234`: c2');
});

test('the review pointer carries the icon and the verdict', () => {
  const icon = { APPROVE: '✅', 'CHANGES REQUESTED': '❌' };
  const body = (verdict) => `<!-- role:review -->\n## ${icon[verdict]} Review\n\n**Commit:** \`abc1234\``;
  assert.equal(formatPointer('review', { body: body('APPROVE'), url: 'p10' }), '✅ Review APPROVE: p10');
  assert.equal(formatPointer('review', { body: body('CHANGES REQUESTED'), url: 'p10' }), '❌ Review CHANGES REQUESTED: p10');
});

test('a result the generators did not write has no pointer', () => {
  assert.throws(() => formatPointer('test', { body: '<!-- role:test -->\nAll good', url: 'c2' }), /generate-report\.js/);
  assert.throws(() => formatPointer('review', { body: '<!-- role:review -->\nLGTM', url: 'p10' }), /generate-review\.js/);
});

test('there is no pointer for another role', () => {
  assert.throws(() => formatPointer('design', { body: '<!-- role:design v1 -->', url: 'x' }), /build, test or review/);
});
