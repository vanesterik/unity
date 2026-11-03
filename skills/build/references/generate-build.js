#!/usr/bin/env node
// Turns the build role's build-data.json into pr-body.md, the pull request body.
// - the issue, the design version and its criteria come from story.json (pipeline.js story), not from the data
// - every criterion of the design is in the table, and no other one
// - the commit list and its count come from git (main..HEAD), never from the data
// - a red unit test suite is refused: the builder doesn't hand one over
// - pr-body.md avoids GitHub mentions: @words in prose are wrapped in backticks
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const usage = () => {
  console.error('Usage: node <plugin>/skills/build/references/generate-build.js artifacts/<n>-<slug>/build-data.json');
  process.exit(1);
};

const fail = (message) => {
  console.error(`${path.basename(dataPath)} invalid: ${message}`);
  process.exit(1);
};

const dataPath = process.argv[2];
if (!dataPath) usage();

const absoluteDataPath = path.resolve(dataPath);
const dir = path.dirname(absoluteDataPath);
const data = JSON.parse(fs.readFileSync(absoluteDataPath, 'utf8'));

// Markdown table cells: no pipes or line breaks.
const flat = (value = '') => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
// Wrap @words in backticks, so GitHub doesn't turn @AC1 into a user mention.
const mentions = (value = '') => String(value).replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, '$1`@$2`');
const code = (value = '') => `\`${flat(value)}\``;
// One sentence: a trailing period added unless it already ends in punctuation.
const sentence = (value = '') => { const text = mentions(flat(value)); return /[.!?]$/.test(text) ? text : `${text}.`; };
// A fenced block whose content can't close the fence.
const fence = (lang, text) => ['```' + lang, String(text).replace(/```/g, "'''").replace(/\s+$/, ''), '```'];
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';
const list = (value) => (Array.isArray(value) ? value : []);

// The branch's own commits, oldest first.
const branchCommits = () => {
  let log;
  try {
    log = execFileSync('git', ['log', '--reverse', '--format=%h %s', 'main..HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`git log main..HEAD failed: ${String(error.stderr || error.message).trim()}`);
  }
  return log ? log.split('\n').map((line) => { const [sha, ...subject] = line.split(' '); return { sha, subject: subject.join(' ') }; }) : [];
};

// ---------- the pull request body ----------

const storyPath = path.join(dir, 'story.json');
if (!fs.existsSync(storyPath)) fail(`no story.json next to it; save it with pipeline.js story <n> > ${path.relative(process.cwd(), storyPath)}`);
const story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
if (!Number.isInteger(story.number) || !Number.isInteger(story.designVersion)) fail('story.json has no issue number or design version; save it again with pipeline.js story <n>');

const designIds = list(story.criteria).map((criterion) => criterion.id);
const criteria = list(data.criteria);
const dataIds = criteria.map((criterion) => criterion && criterion.id);
if (!designIds.length) fail('the design in story.json has no criteria');
if (dataIds.join(',') !== designIds.join(',')) fail(`"criteria" must list every criterion of the design, in order: the design has ${designIds.join(', ')}; the data has ${dataIds.join(', ') || 'none'}`);
for (const criterion of criteria) {
  if (!list(criterion.implemented).filter(nonEmpty).length) fail(`${criterion.id} needs "implemented": the files and functions that implement it`);
}

if (!nonEmpty(data.summary)) fail('"summary" is required');
const run = list(data.run).filter(nonEmpty);
if (!run.length) fail('"run" needs the commands to start or use what was built');
const deviations = list(data.deviations).map((entry, index) => {
  if (!entry || !nonEmpty(entry.ruling) || !nonEmpty(entry.reason) || !nonEmpty(entry.cost)) fail(`deviations ${index + 1} needs a "ruling", a "reason" and a "cost"`);
  return entry;
});

const unit = data.unitTests || {};
if (!nonEmpty(unit.command) || !nonEmpty(unit.output)) fail('"unitTests" needs the "command" and the tail of its "output"');
if (!Number.isInteger(unit.passed) || !Number.isInteger(unit.total) || unit.total < 1 || unit.passed > unit.total) fail('"unitTests" needs whole numbers "passed" and "total", with passed <= total');
if (unit.passed < unit.total) fail(`${unit.passed}/${unit.total} unit tests passed; a red suite is not handed over, so fix it or stop and report the failures`);

const commits = branchCommits();
if (!commits.length) fail('there are no commits on this branch (main..HEAD) yet');

const md = [];
md.push('<!-- role:build -->');
md.push(`Closes #${story.number}`);
md.push('');
md.push(`**Design:** v${story.designVersion}  `);
md.push(`**Commits:** ${commits.length}  `);
md.push(`**Unit tests:** ${unit.passed}/${unit.total} passed`);
md.push('');
md.push('## Summary');
md.push('');
md.push(mentions(data.summary.trim()));
md.push('');
md.push('## Acceptance criteria');
md.push('');
md.push('| Criterion | Implemented in | Unit tests |');
md.push('| --- | --- | --- |');
for (const criterion of criteria) {
  const tests = list(criterion.unitTests).filter(nonEmpty);
  md.push(`| ${criterion.id} | ${criterion.implemented.filter(nonEmpty).map(code).join(', ')} | ${tests.length ? tests.map(code).join(', ') : 'verified by the test role'} |`);
}
md.push('');
md.push('## Review commit by commit');
md.push('');
commits.forEach((commit, index) => md.push(`${index + 1}. ${code(commit.sha)} ${mentions(commit.subject)}`));
md.push('');
md.push('## Deviations from the design');
md.push('');
md.push(...(deviations.length ? deviations.map((entry) => `- **${sentence(entry.ruling)}** ${sentence(entry.reason)} If wrong: ${sentence(entry.cost)}`) : ['None.']));
md.push('');
md.push('## How to run it');
md.push('');
md.push(...fence('bash', run.join('\n')));
md.push('');
md.push('## Unit tests');
md.push('');
md.push(code(unit.command));
md.push('');
md.push(...fence('', unit.output));

const bodyPath = path.join(dir, 'pr-body.md');
fs.writeFileSync(bodyPath, md.join('\n') + '\n');
console.log(JSON.stringify({ body: bodyPath, commits: commits.length, criteria: criteria.length, unitTests: { passed: unit.passed, total: unit.total } }));
