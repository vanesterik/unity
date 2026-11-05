const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'build', 'references', 'generate-plan.js');

const plan = `# Greet in Dutch Implementation Plan

> Execute with superpowers:executing-plans.

## Task 1: Add the Dutch word (AC1)

\`\`\`js
// ## Task 9: not a heading inside a code block
\`\`\`

### Step 1
Write the failing test.

## Task 2: Add the flag (AC2)
`;

const story = { number: 9, design: '<!-- role:design v2 -->\n## Context\n...', designVersion: 2, criteria: [{ id: 'AC1' }, { id: 'AC2' }] };

// Runs the generator on plan.md, with story.json next to it.
const generate = ({ planText = plan, storyData = story } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-plan-'));
  fs.writeFileSync(path.join(dir, 'plan.md'), planText);
  if (storyData) fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(storyData));
  return { dir, result: spawnSync('node', [generator, path.join(dir, 'plan.md')], { encoding: 'utf8' }) };
};

const commentFor = (options) => {
  const { dir, result } = generate(options);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'plan-comment.md'), 'utf8');
};

const refusal = (options) => {
  const { result } = generate(options);
  assert.notEqual(result.status, 0, 'expected a refusal');
  return result.stderr;
};

test('the comment names the design version it implements', () => {
  assert.match(commentFor(), /^<!-- role:plan design v2 -->\n## Implementation plan · design v2\n/);
});

test('the plan sits in a collapsed block with its task count and headings demoted below ##', () => {
  const comment = commentFor();
  assert.match(comment, /<details>\n<summary>2 tasks<\/summary>\n\n### Greet in Dutch Implementation Plan\n/);
  assert.match(comment, /\n#### Task 1: Add the Dutch word \(AC1\)\n/);
  assert.match(comment, /\n##### Step 1\n/);
  assert.match(comment, /\/\/ ## Task 9: not a heading inside a code block\n/);
  assert.match(comment, /\n#### Task 2: Add the flag \(AC2\)\n\n<\/details>\n$/);
});

test('one task reads as 1 task', () => {
  assert.match(commentFor({ planText: '## Task 1: Everything (AC1, AC2)\n' }), /<summary>1 task<\/summary>/);
});

test('it refuses a plan without Task headings', () => {
  assert.match(refusal({ planText: '# Plan\n\nDo it all.\n' }), /plan\.md has no "Task <n>" headings/);
});

test('it refuses a criterion the design does not have', () => {
  assert.match(refusal({ planText: plan.replace('(AC2)', '(AC5)') }), /AC5 is mentioned, but the design's criteria are AC1-AC2/);
});

test('it refuses an issue without a design', () => {
  assert.match(refusal({ storyData: { number: 9, design: null, designVersion: null, criteria: [] } }), /#9 has no design comment/);
  assert.match(refusal({ storyData: null }), /story\.json/);
});

test('it refuses a plan.md that holds a role comment instead of the plan', () => {
  assert.match(refusal({ planText: `<!-- role:design v1 -->\n${plan}` }), /plan\.md holds a role comment/);
  assert.match(refusal({ planText: `<!-- role:plan design v1 -->\n${plan}` }), /plan\.md holds a role comment/);
});

test('it refuses a comment over GitHub\'s size limit instead of trimming it', () => {
  assert.match(refusal({ planText: `${plan}\n${'x'.repeat(66000)}\n` }), /over GitHub's limit of 65000/);
});

test('it prints the path it wrote, the design version and the task count as JSON', () => {
  const { dir, result } = generate();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { comment: path.join(dir, 'plan-comment.md'), designVersion: 2, tasks: 2 });
});
