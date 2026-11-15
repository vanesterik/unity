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
