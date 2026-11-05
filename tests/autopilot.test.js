const test = require('node:test');
const assert = require('node:assert/strict');
const { reworksSince, maxReworks, stoppedPlan, formatStopComment } = require('../scripts/pipeline.js');

const prBody = { source: 'pr-body', body: '<!-- role:build -->\n**Design:** v1\n\nCloses #8', createdAt: '2026-11-05T10:01:00Z' };
const rework = (createdAt) => ({ source: 'pr-comment', body: '<!-- role:build -->\n## Rework for test findings\n\n**Fixed:** 1', createdAt });
const testFail = { source: 'pr-comment', body: '<!-- role:test -->\n## ❌ Test FAILURE · #8', createdAt: '2026-11-05T10:20:00Z' };

test('reworksSince ignores reworks before the run', () => {
  const entries = [prBody, rework('2026-11-04T09:00:00Z'), testFail, rework('2026-11-05T10:30:00Z'), rework('2026-11-05T11:30:00Z')];
  assert.equal(reworksSince(entries, '2026-11-05T10:00:00Z'), 2);
});

test('reworksSince does not count the PR body or other roles', () => {
  assert.equal(reworksSince([prBody, testFail], '2026-11-05T10:00:00Z'), 0);
});

test('maxReworks defaults to 2', () => {
  assert.equal(maxReworks({}), 2);
  assert.equal(maxReworks({ autopilot: { maxReworks: 0 } }), 0);
  assert.equal(maxReworks({ autopilot: { maxReworks: 3 } }), 3);
  assert.equal(maxReworks({ autopilot: { maxReworks: 'x' } }), 2);
  assert.equal(maxReworks({ autopilot: { maxReworks: -1 } }), 2);
});

test('stoppedPlan resumes a stopped story back in Build', () => {
  assert.deepEqual(stoppedPlan([{ number: 7, title: 'A', column: 'Build' }]), { resume: 7, clear: [], blocked: [] });
});

test('stoppedPlan clears a stopped story that is Done', () => {
  assert.deepEqual(stoppedPlan([{ number: 7, title: 'A', column: 'Done' }]), { resume: null, clear: [7], blocked: [] });
});

test('stoppedPlan blocks when any stopped story is outside Build and Done', () => {
  const plan = stoppedPlan([{ number: 7, title: 'A', column: 'Build' }, { number: 8, title: 'B', column: 'Test' }]);
  assert.deepEqual(plan, { resume: null, clear: [], blocked: [{ number: 8, title: 'B', column: 'Test' }] });
  for (const column of ['Design', 'Review', 'Backlog', null]) {
    assert.deepEqual(stoppedPlan([{ number: 9, title: 'C', column }]).blocked, [{ number: 9, title: 'C', column }]);
  }
});

test('stoppedPlan with nothing stopped starts from the queue', () => {
  assert.deepEqual(stoppedPlan([]), { resume: null, clear: [], blocked: [] });
});

test('formatStopComment says why the run stopped and how to continue', () => {
  assert.equal(formatStopComment({ number: 8, reason: 'failed test after 2 reworks', url: 'https://x/c1' }), [
    '<!-- autopilot:stopped -->',
    '**Autopilot stopped at #8:** failed test after 2 reworks',
    'https://x/c1',
    'Move the story back to Build to try again, or finish it with /unity:ship 8; the next /unity:autopilot continues from there.',
  ].join('\n\n'));
  assert.ok(!formatStopComment({ number: 8, reason: 'r' }).includes('undefined'));
});
