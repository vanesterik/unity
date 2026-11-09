#!/usr/bin/env node
// Turns /unity:test's test-run.json into pr-body.md, the body of the test run's pull request.
// - the heading is ✅ Test when every test passed, ❌ Test otherwise
// - every failing test names the new story it was filed as, and the failing count matches the run
// - the commits and the head commit come from git (main..HEAD), never from the data
// - @words in prose are wrapped in backticks, so GitHub mentions nobody, and so is the #n after a closing
//   keyword, so merging the test run closes no issue
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dataPath = process.argv[2];
if (!dataPath) {
  console.error('Usage: node <plugin>/skills/test/references/generate-test-run.js artifacts/test-run-<stamp>/test-run.json');
  process.exit(1);
}

const fail = (message) => {
  console.error(`${path.basename(dataPath)} invalid: ${message}`);
  process.exit(1);
};

const absoluteDataPath = path.resolve(dataPath);
const dir = path.dirname(absoluteDataPath);
const data = JSON.parse(fs.readFileSync(absoluteDataPath, 'utf8'));

// Markdown table cells: no pipes or line breaks.
const flat = (value = '') => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
const mentions = (value = '') => String(value)
  .replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, '$1`@$2`')
  .replace(/\b((?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+)#(\d+)/gi, '$1`#$2`');
const code = (value = '') => `\`${flat(value)}\``;
const list = (value) => (Array.isArray(value) ? value : []);
const count = (value) => Number.isInteger(value) && value >= 0;

const branchCommits = () => {
  let log;
  try {
    log = execFileSync('git', ['log', '--reverse', '--format=%h %s', 'main..HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`git log main..HEAD failed: ${String(error.stderr || error.message).trim()}`);
  }
  return log ? log.split('\n').map((line) => {
    const [sha, ...subject] = line.split(' ');
    return { sha, subject: subject.join(' ') };
  }) : [];
};

const ACTIONS = ['added', 'rewritten', 'kept', 'deleted'];
const KINDS = { integration: 'integration', e2e: 'E2E' };

const kinds = list(data.kinds);
if (!kinds.length || !kinds.every((kind) => Object.hasOwn(KINDS, kind))) fail('"kinds" lists the kinds of tests the run covered: integration, e2e or both, as pipeline.js test-kinds prints them');
const run = data.run || {};
if (!count(run.passed) || !count(run.total) || run.passed > run.total) fail('"run" needs whole numbers "passed" and "total", with passed <= total');
const suite = data.suite || {};
if (!count(suite.before) || !count(suite.after)) fail('"suite" needs whole numbers "before" and "after"');
const flows = list(data.flows);
const changes = list(data.changes);
const failing = list(data.failing);
const stories = list(data.stories);
const positive = (value) => Number.isInteger(value) && value > 0;
for (const story of stories) {
  if (!positive(story.number)) fail(`story "${story.title}" needs the issue "number" that pipeline.js new-story printed`);
}
for (const change of changes) {
  if (typeof change.file !== 'string' || !change.file.trim()) fail(`a change with action "${change.action}" needs a "file"`);
  if (!ACTIONS.includes(change.action)) fail(`change "${change.file}" has action "${change.action}"; use ${ACTIONS.join(', ')}`);
}
if (failing.length !== run.total - run.passed) fail(`"failing" lists ${failing.length} tests, but the run has ${run.total - run.passed} failing`);
const storyOf = new Map(stories.map((story) => [story.number, story]));
for (const entry of failing) {
  if (!positive(entry.story) || !storyOf.has(entry.story)) fail(`failing test "${entry.test}" names story #${entry.story}, which is not among "stories": file a story for every failure`);
}
const commits = branchCommits();
if (!commits.length) fail('the branch has no commits since main');

const md = [];
md.push('<!-- unity:test-run -->');
md.push(`## ${run.passed === run.total ? '✅' : '❌'} Test`);
md.push('');
md.push(`**Kinds:** ${kinds.map((kind) => KINDS[kind]).join(', ')}  `);
md.push(`**Suite:** ${suite.before} → ${suite.after} tests  `);
md.push(`**Run:** ${run.passed}/${run.total} passed  `);
md.push(`**New stories:** ${stories.length ? stories.map((story) => `#${story.number}`).join(', ') : 'none'}  `);
md.push(`**Commit:** ${code(commits[commits.length - 1].sha)}`);
md.push('');
if (flows.length) {
  md.push('## Flows', '', '| Flow | Stories | Tests |', '| --- | --- | --- |');
  md.push(...flows.map((flow) => `| ${mentions(flat(flow.name))} | ${list(flow.issues).map((n) => `#${n}`).join(', ')} | ${list(flow.tests).map(code).join(', ')} |`));
  md.push('');
}
if (changes.length) {
  md.push('## Changes', '', '| Change | File | Why |', '| --- | --- | --- |');
  md.push(...changes.map((change) => `| ${change.action} | ${code(change.file)} | ${mentions(flat(change.reason))} |`));
  md.push('');
}
if (failing.length) {
  md.push('## Failing', '', '| Test | Story |', '| --- | --- |');
  md.push(...failing.map((entry) => `| ${code(entry.test)} | #${entry.story} ${mentions(flat(storyOf.get(entry.story).title))} |`));
  md.push('');
}
md.push('## Review commit by commit', '');
md.push(...commits.map((commit, index) => `${index + 1}. ${mentions(commit.subject)}`));

const bodyPath = path.join(dir, 'pr-body.md');
fs.writeFileSync(bodyPath, md.join('\n') + '\n');
console.log(JSON.stringify({ path: bodyPath, passed: run.passed, total: run.total, stories: stories.map((story) => story.number) }));
