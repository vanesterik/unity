const test = require('node:test');
const assert = require('node:assert/strict');
const { shippedDesigns } = require('../scripts/pipeline.js');

const design = (version, criteria) => ({
  body: `<!-- role:design v${version} -->\n## Design\n\nText.\n\n## Acceptance criteria\n${criteria.map((c, i) => `- AC${i + 1}: ${c}`).join('\n')}\n`,
  createdAt: `2026-11-0${version}T10:00:00Z`,
});

test('shippedDesigns keeps closed issues with a design, latest version and its criteria', () => {
  const issues = [
    { number: 5, title: 'Plan before buying', state: 'CLOSED', comments: [design(1, ['Old rule']), { body: 'Thanks', createdAt: '2026-11-03T10:00:00Z' }, design(2, ['A buy needs a plan', 'The refusal says so'])] },
    { number: 6, title: 'In flight', state: 'OPEN', comments: [design(1, ['Not shipped'])] },
    { number: 7, title: 'No design', state: 'CLOSED', comments: [{ body: 'Done by hand', createdAt: '2026-11-01T10:00:00Z' }] },
  ];
  assert.deepEqual(shippedDesigns(issues), [{
    number: 5,
    title: 'Plan before buying',
    version: 2,
    criteria: [{ id: 'AC1', text: 'A buy needs a plan' }, { id: 'AC2', text: 'The refusal says so' }],
  }]);
});

test('shippedDesigns sorts by issue number', () => {
  const issues = [12, 3, 8].map((number) => ({ number, title: `#${number}`, state: 'CLOSED', comments: [design(1, ['Rule'])] }));
  assert.deepEqual(shippedDesigns(issues).map((d) => d.number), [3, 8, 12]);
});

test('shippedDesigns leaves out issues closed as not planned', () => {
  const issues = [
    { number: 3, title: 'Shipped', state: 'CLOSED', stateReason: 'COMPLETED', comments: [design(1, ['Rule'])] },
    { number: 4, title: 'Abandoned', state: 'CLOSED', stateReason: 'NOT_PLANNED', comments: [design(1, ['Rule'])] },
  ];
  assert.deepEqual(shippedDesigns(issues).map((d) => d.number), [3]);
});
