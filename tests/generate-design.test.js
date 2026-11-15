const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const generator = path.join(__dirname, '..', 'skills', 'design', 'references', 'generate-design.js');

const design = `# Greet in Dutch

## Context
Dutch users want a Dutch greeting.

## Design
A \`--dutch\` flag picks the Dutch word. AC2 covers the flag.

### Parsing
The flag is read before the name.

## Acceptance criteria
- AC1: \`node greet.js --dutch Koen\` prints \`Hallo, Koen!\`
- AC2: \`node greet.js --dutch\` without a name prints the usage line

## Out of scope
Other languages.

## Risks and open questions
None known.
`;

const story = { number: 9, design: null, designVersion: null };

// Runs the generator on design.md, with story.json next to it.
const generate = ({ designText = design, storyData = story } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unity-design-'));
  fs.writeFileSync(path.join(dir, 'design.md'), designText);
  if (storyData) fs.writeFileSync(path.join(dir, 'story.json'), JSON.stringify(storyData));
  return { dir, result: spawnSync('node', [generator, path.join(dir, 'design.md')], { encoding: 'utf8' }) };
};

const commentFor = (options) => {
  const { dir, result } = generate(options);
  assert.equal(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(dir, 'comment.md'), 'utf8');
};

const refusal = (options) => {
  const { result } = generate(options);
  assert.notEqual(result.status, 0);
  return result.stderr;
};

test('a first design gets the v1 marker and the five sections, without the draft title', () => {
  const comment = commentFor();
  assert.match(comment, /^<!-- role:design v1 -->\n## Context\nDutch users want a Dutch greeting\.\n\n## Design\n/);
  assert.match(comment, /### Parsing\nThe flag is read before the name\.\n\n## Acceptance criteria\n- AC1: /);
  assert.match(comment, /\n## Out of scope\nOther languages\.\n\n## Risks and open questions\nNone known\.\n$/);
  assert.doesNotMatch(comment, /# Greet in Dutch\n/);
});

test('a revision gets the previous version plus one', () => {
  const comment = commentFor({ storyData: { number: 9, design: '<!-- role:design v2 -->', designVersion: 2 } });
  assert.match(comment, /^<!-- role:design v3 -->\n/);
});

test('it refuses criteria numbered with a gap', () => {
  const stderr = refusal({ designText: design.replace('- AC2:', '- AC3:') });
  assert.match(stderr, /criterion 2 is numbered AC3; number them AC1, AC2, \.\.\. without gaps/);
});

test('it refuses a line in the criteria section that is not a criterion', () => {
  const stderr = refusal({ designText: design.replace('- AC2:', 'Also:\n- AC2:') });
  assert.match(stderr, /"Also:" under Acceptance criteria/);
});

test('it refuses a missing, empty or extra section', () => {
  assert.match(refusal({ designText: design.replace('## Out of scope\nOther languages.\n\n', '') }), /sections must be Context, Design, Acceptance criteria, Out of scope, Risks and open questions; found Context, Design, Acceptance criteria, Risks and open questions/);
  assert.match(refusal({ designText: design.replace('Other languages.', '') }), /"Out of scope" is empty/);
  assert.match(refusal({ designText: design.replace('## Out of scope', '## Notes\nA note.\n\n## Out of scope') }), /found Context, Design, Acceptance criteria, Notes, Out of scope/);
});

test('it refuses a mention of a criterion that does not exist', () => {
  assert.match(refusal({ designText: design.replace('AC2 covers the flag', 'AC4 covers the flag') }), /AC4 is mentioned, but the criteria are AC1-AC2/);
});

test('it refuses to run without story.json', () => {
  assert.match(refusal({ storyData: null }), /story\.json/);
});

test('the comment is the design alone: it ends after Risks and open questions, with no plan', () => {
  const comment = commentFor();
  assert.match(comment, /\n## Risks and open questions\nNone known\.\n$/);
  assert.doesNotMatch(comment, /Implementation plan|<details>/);
});

test('it refuses a comment over GitHub\'s size limit instead of trimming it', () => {
  assert.match(refusal({ designText: design.replace('None known.', 'x'.repeat(66000)) }), /over GitHub's limit of 65000/);
});

test('it prints the version, the counts and the path it wrote as JSON', () => {
  const { dir, result } = generate();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { comment: path.join(dir, 'comment.md'), designVersion: 1, criteria: 2, criteriaLimit: 8, large: false });
});

test('it refuses a subheading called Acceptance criteria before the real one, which the parser would read instead', () => {
  assert.match(refusal({ designText: design.replace('### Parsing', '### Acceptance criteria for parsing') }), /"### Acceptance criteria for parsing" in Design/);
});


// A design with the given number of criteria.
const designWith = (count) => design.replace(/- AC1:[\s\S]*?\n\n## Out of scope/, `${Array.from({ length: count }, (_, i) => `- AC${i + 1}: Rule ${i + 1} holds`).join('\n')}\n\n## Out of scope`);

test('a design at the criteria limit is not large', () => {
  const { result } = generate({ designText: designWith(8) });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.criteria, 8);
  assert.equal(output.large, false);
});

test('a design above the criteria limit is reported as large, and its comment is still written', () => {
  const { dir, result } = generate({ designText: designWith(9) });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual([output.criteria, output.criteriaLimit, output.large], [9, 8, true]);
  assert.match(fs.readFileSync(path.join(dir, 'comment.md'), 'utf8'), /\n- AC9: Rule 9 holds\n/);
});

test('another story\'s criterion, written with its issue, is not checked against this design', () => {
  const comment = commentFor({ designText: design.replace('AC2 covers the flag.', 'AC2 covers the flag. This supersedes #9 AC5 and AC6, and #15\'s AC7.') });
  assert.match(comment, /This supersedes #9 AC5 and AC6, and #15's AC7\./);
});

test('the refusal of an unknown criterion says how to write another story\'s', () => {
  assert.match(refusal({ designText: design.replace('AC2 covers the flag', 'AC7 of the old story covers the flag') }), /AC7 is mentioned, but the criteria are AC1-AC2; write another story's criterion with its issue, as in "#15 AC7"/);
});
