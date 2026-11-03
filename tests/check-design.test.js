const test = require('node:test');
const assert = require('node:assert/strict');
const { compareComment } = require('../scripts/pipeline.js');

const comment = '<!-- role:design v2 -->\n## Context\nWhy.\n\n## Acceptance criteria\n- AC1: It greets\n';

test('compareComment accepts the posted comment when it is the generated one', () => {
  assert.equal(compareComment(comment, comment), null);
});

test('compareComment ignores line endings and trailing whitespace that GitHub may change', () => {
  assert.equal(compareComment(comment.replace(/\n/g, '\r\n').trimEnd(), comment), null);
});

test('compareComment names the first line that differs', () => {
  const posted = comment.replace('- AC1: It greets', '- AC1: It greets loudly');
  assert.equal(compareComment(posted, comment), 'line 6 differs: posted "- AC1: It greets loudly", generated "- AC1: It greets"');
});

test('compareComment says so when no design comment was found', () => {
  assert.equal(compareComment(null, comment), 'the issue has no design comment');
});

test('compareComment notices a posted comment that stops early', () => {
  assert.equal(compareComment('<!-- role:design v2 -->\n## Context', comment), 'line 3 differs: posted "", generated "Why."');
});
