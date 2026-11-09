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
  review: { role: 'review', status: 'APPROVE', commit: 'abc1234' },
  checks: 'pass',
  draft: false,
};

test('mergeDecision merges a story approved on its head, without any test result', () => {
  assert.deepEqual(mergeDecision(ready), { mergeable: true, reasons: [] });
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
  assert.deepEqual(mergeDecision({ ...ready, checks: 'pending' }).reasons, ['CI checks still running after 8 minutes']);
  assert.deepEqual(mergeDecision({ ...ready, draft: true }).reasons, ['the pull request is a draft']);
});

test('mergeDecision lists every reason at once', () => {
  const result = mergeDecision({ ...ready, review: null, checks: 'fail', draft: true });
  assert.equal(result.mergeable, false);
  assert.deepEqual(result.reasons, ['the review did not approve', 'a CI check failed', 'the pull request is a draft']);
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

const { parseChecksOutput, mergeArgs, mergeOutcome } = require('../scripts/pipeline.js');

test('parseChecksOutput reads the checks gh printed, whatever its exit code', () => {
  assert.deepEqual(parseChecksOutput({ stdout: '[{"bucket":"pass"}]' }), [{ bucket: 'pass' }]);
  assert.deepEqual(parseChecksOutput({ stdout: '[{"bucket":"fail"}]', stderr: '', failed: true }), [{ bucket: 'fail' }]);
});

test('parseChecksOutput treats "no checks reported" as no checks', () => {
  assert.deepEqual(parseChecksOutput({ stdout: '', stderr: "no checks reported on the 'feature/7-x' branch", failed: true }), []);
});

test('parseChecksOutput refuses any other gh error instead of counting it as passing', () => {
  assert.throws(() => parseChecksOutput({ stdout: '', stderr: 'HTTP 401: Bad credentials', failed: true }), /could not read the CI checks: HTTP 401/);
});

test('mergeArgs pins the merge to the head commit that was checked', () => {
  assert.deepEqual(mergeArgs(31, 'abc1234ff00'), ['pr', 'merge', '31', '--rebase', '--match-head-commit', 'abc1234ff00']);
});

test('mergeOutcome only counts a merge GitHub completed', () => {
  assert.deepEqual(mergeOutcome({ state: 'MERGED' }), { merged: true });
  assert.deepEqual(mergeOutcome({ state: 'OPEN' }), { merged: false, reason: 'the merge was queued, not completed' });
});

test('mergeOutcome keeps a merge that gh reported as failed after it went through', () => {
  assert.deepEqual(mergeOutcome({ error: 'failed to delete local branch', state: 'MERGED' }), { merged: true, warning: 'gh: failed to delete local branch' });
});

test('mergeOutcome passes on GitHub refusing the merge', () => {
  assert.deepEqual(mergeOutcome({ error: 'Required approving review', state: 'OPEN' }), { merged: false, reason: 'GitHub refused the merge: Required approving review' });
});

const { branchCleanup } = require('../scripts/pipeline.js');

test('branchCleanup keeps a branch with commits that are not on main, without switching', () => {
  assert.deepEqual(branchCleanup({ branch: 'feature/7-x', missing: 2, checkedOut: true, dirty: false }), {
    switchToMain: false, deleteBranch: false, warning: 'kept local branch feature/7-x: 2 commit(s) not on main',
  });
});

test('branchCleanup keeps a checked-out branch with uncommitted changes, without switching', () => {
  assert.deepEqual(branchCleanup({ branch: 'feature/7-x', missing: 0, checkedOut: true, dirty: true }), {
    switchToMain: false, deleteBranch: false, warning: 'kept local branch feature/7-x: it is checked out with uncommitted changes',
  });
});

test('branchCleanup switches a clean checkout to main and deletes the branch', () => {
  assert.deepEqual(branchCleanup({ branch: 'feature/7-x', missing: 0, checkedOut: true, dirty: false }), {
    switchToMain: true, deleteBranch: true, warning: null,
  });
});

test('branchCleanup deletes a branch that is not checked out, without switching', () => {
  assert.deepEqual(branchCleanup({ branch: 'feature/7-x', missing: 0, checkedOut: false, dirty: true }), {
    switchToMain: false, deleteBranch: true, warning: null,
  });
});
