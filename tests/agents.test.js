const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const agent = (name) => fs.readFileSync(path.join(root, 'agents', `${name}.md`), 'utf8');
const frontmatter = (text) => (text.match(/^---\n([\s\S]*?)\n---\n/) || [])[1] || '';
const modelOf = (name) => (frontmatter(agent(name)).match(/^model:\s*(\S+)\s*$/m) || [])[1] || null;

test('the builder and the tester are pinned to sonnet', () => {
  assert.equal(modelOf('builder'), 'sonnet');
  assert.equal(modelOf('tester'), 'sonnet');
});

test('the reviewer inherits the session model, and says why', () => {
  assert.equal(modelOf('reviewer'), 'inherit');
  assert.match(agent('reviewer'), /`model: inherit` on purpose/);
});

test('the README names the model of every role', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  for (const name of ['builder', 'reviewer', 'tester']) {
    const row = readme.split('\n').find((line) => line.startsWith('|') && line.includes(`\`unity:${name}\``) && /sonnet|inherit/.test(line));
    assert.ok(row, `no model row for unity:${name}`);
    assert.ok(row.includes(modelOf(name)), `the README row for ${name} doesn't name ${modelOf(name)}`);
  }
});

test('the reviewer fetches the diff once', () => {
  const text = agent('reviewer');
  assert.equal((text.match(/^gh pr diff <pr>$/gm) || []).length, 1);
  assert.doesNotMatch(text, /The full diff, commit by commit/);
});

test('the builder loads at most three Superpowers skills, the debugging one only for a failure it does not understand', () => {
  const text = agent('builder');
  const skills = [...new Set([...text.matchAll(/superpowers:([a-z-]+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(skills, ['systematic-debugging', 'test-driven-development', 'writing-plans']);
  assert.match(text, /`superpowers:systematic-debugging`, the last only when something fails for a reason you don't understand/);
  assert.match(text, /don't load those two skills/);
});

test('the builder also loads the pattern skill for the code it writes, when one is installed', () => {
  const text = agent('builder');
  assert.match(text, /the pattern skill for the language or framework of the code you write/);
  assert.match(text, /if one is installed/);
});

test('the reviewer can load skills, and judges the code against its pattern skill', () => {
  const tools = (frontmatter(agent('reviewer')).match(/^tools:\s*(.+)$/m) || [])[1] || '';
  assert.ok(tools.split(/,\s*/).includes('Skill'), 'the reviewer has no Skill tool');
  assert.match(agent('reviewer'), /the pattern skill for the language or framework of the change/);
});
