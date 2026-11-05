const test = require('node:test');
const assert = require('node:assert/strict');
const { checksState, mergeDecision, mergedRange } = require('../scripts/pipeline.js');

test('checksState treats no checks as pass', () => {
  assert.equal(checksState(null), 'pass');
  assert.equal(checksState([]), 'pass');
});

test('checksState passes when every check passed or was skipped', () => {
  assert.equal(checksState([{ bucket: 'pass' }, { bucket: 'skipping' }]), 'pass');
});

test('checksState is pending while a check runs', () => {
  assert.equal(checksState([{ bucket: 'pass' }, { bucket: 'pending' }]), 'pending');
});

test('checksState fails on a failed or cancelled check, even with one still running', () => {
  assert.equal(checksState([{ bucket: 'fail' }]), 'fail');
  assert.equal(checksState([{ bucket: 'cancel' }]), 'fail');
  assert.equal(checksState([{ bucket: 'pending' }, { bucket: 'fail' }]), 'fail');
});

const ready = {
  number: 7,
  column: 'Review',
  pr: { number: 31, headSha: 'abc1234ff00' },
  coverage: { covers: true },
  review: { role: 'review', status: 'APPROVE', commit: 'abc1234' },
  checks: 'pass',
  draft: false,
};

test('mergeDecision merges a story tested and approved on its head', () => {
  assert.deepEqual(mergeDecision(ready), { mergeable: true, reasons: [] });
});

test('mergeDecision refuses a pass on an older commit', () => {
  assert.deepEqual(mergeDecision({ ...ready, coverage: { covers: false } }), {
    mergeable: false,
    reasons: ['the test result does not cover the head commit'],
  });
});

test('mergeDecision refuses an approval on another commit', () => {
  const result = mergeDecision({ ...ready, review: { ...ready.review, commit: 'def5678' } });
  assert.deepEqual(result.reasons, ['the approval is not on the head commit']);
});

test('mergeDecision refuses requested changes, and a story without a review', () => {
  assert.deepEqual(mergeDecision({ ...ready, review: { ...ready.review, status: 'CHANGES REQUESTED' } }).reasons, ['the review did not approve']);
  assert.deepEqual(mergeDecision({ ...ready, review: null }).reasons, ['the review did not approve']);
});

test('mergeDecision refuses a story outside Review', () => {
  assert.deepEqual(mergeDecision({ ...ready, column: 'Build' }).reasons, ['#7 is in Build, not Review']);
  assert.deepEqual(mergeDecision({ ...ready, column: null }).reasons, ['#7 is not on the board']);
});

test('mergeDecision refuses without an open pull request', () => {
  assert.deepEqual(mergeDecision({ ...ready, pr: null }), { mergeable: false, reasons: ['no open pull request'] });
});

test('mergeDecision refuses on failed or still-running CI, and a draft', () => {
  assert.deepEqual(mergeDecision({ ...ready, checks: 'fail' }).reasons, ['a CI check failed']);
  assert.deepEqual(mergeDecision({ ...ready, checks: 'pending' }).reasons, ['CI checks still running after 15 minutes']);
  assert.deepEqual(mergeDecision({ ...ready, draft: true }).reasons, ['the pull request is a draft']);
});

test('mergeDecision lists every reason at once', () => {
  const result = mergeDecision({ ...ready, coverage: { covers: false }, checks: 'fail', draft: true });
  assert.equal(result.mergeable, false);
  assert.deepEqual(result.reasons, ['the test result does not cover the head commit', 'a CI check failed', 'the pull request is a draft']);
});

const log = [
  { sha: 'd'.repeat(40), subject: 'D' },
  { sha: 'c'.repeat(40), subject: 'C' },
  { sha: 'b'.repeat(40), subject: 'B' },
  { sha: 'a'.repeat(40), subject: 'A' },
  { sha: 'f'.repeat(40), subject: 'Z' },
];

test('mergedRange finds the pull request commits as one run on main', () => {
  assert.deepEqual(mergedRange(['A', 'B', 'C'], log), { first: 'a'.repeat(40), last: 'c'.repeat(40), count: 3 });
});

test('mergedRange is null when a commit is not on main', () => {
  assert.equal(mergedRange(['A', 'B', 'X'], log), null);
  assert.equal(mergedRange([], log), null);
});
