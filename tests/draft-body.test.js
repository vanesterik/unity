// The draft pull request's body, as generate-build.js --draft writes it, read by pipeline.js while
// the build is still going on: the PR is found for its issue, and nothing reads a build result yet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { prForIssue, closesIssue, latestResult, runResults, signOffs, boardWarnings, formatSummary } = require('../scripts/pipeline.js');

const generator = path.join(__dirname, '..', 'skills', 'build', 'references', 'generate-build.js');

const draftBody = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-draft-'));
  const storyPath = path.join(dir, 'story.json');
  fs.writeFileSync(storyPath, JSON.stringify({ number: 9, title: 'Greet in Dutch', designVersion: 1, criteria: [{ id: 'AC1', text: 'Greets in Dutch' }] }));
  const result = spawnSync('node', [generator, storyPath, '--draft'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'pr-draft.md'), 'utf8');
};

const body = draftBody();
const pr = { number: 10, url: 'https://github.com/o/r/pull/10', headRefName: 'feature/9-greet-in-dutch', body, createdAt: '2026-11-05T09:00:00Z' };
const entries = [{ source: 'pr-body', body, createdAt: pr.createdAt, url: pr.url }];

test('the draft PR is found for its issue, so a second builder run sees it', () => {
  assert.equal(prForIssue([pr], 9), pr);
  assert.equal(closesIssue(body), 9);
});

test('the draft PR is no build result: the board, the summary and the sign-offs wait for the handover', () => {
  assert.equal(latestResult(entries), null);
  assert.deepEqual(runResults(entries, '2026-11-05T08:00:00Z'), []);
  assert.deepEqual(signOffs(entries), []);
});

test('a build that stopped before its handover is summarised as no result, with the PR', () => {
  const summary = formatSummary({ number: 9, title: 'Greet in Dutch', pr: { number: 10 }, column: 'Build', next: '/unity:ship 9', results: runResults(entries) });
  assert.equal(summary, '**#9 Greet in Dutch** · PR #10\n\nNo role posted a result in this run.\n\n**Column:** Build → `/unity:ship 9`');
});

test('the draft PR raises no board warning for an issue on the board', () => {
  assert.deepEqual(boardWarnings({ issues: [{ number: 9 }], openPrs: [pr], mergedPrs: [], openIssues: [{ number: 9 }] }), []);
});
