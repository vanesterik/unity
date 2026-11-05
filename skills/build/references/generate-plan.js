#!/usr/bin/env node
// Turns the builder's plan (plan.md) into plan-comment.md, the plan comment on the pull request.
// - the design version it implements comes from story.json (pipeline.js story)
// - every AC<n> the plan mentions is a criterion of that design
// - the plan's headings are demoted below ##, and it goes in a collapsed block with its task count
// - a comment over GitHub's size limit is refused, never trimmed
const fs = require('fs');
const path = require('path');

const LIMIT = 65000;

const usage = () => {
  console.error('Usage: node <plugin>/skills/build/references/generate-plan.js artifacts/<n>-<slug>/plan.md');
  process.exit(1);
};

const fail = (message) => {
  console.error(`plan invalid: ${message}`);
  process.exit(1);
};

const planPath = process.argv[2];
if (!planPath) usage();

const dir = path.dirname(path.resolve(planPath));
const storyPath = path.join(dir, 'story.json');
if (!fs.existsSync(storyPath)) fail('no story.json next to plan.md; save it with pipeline.js story <n> > artifacts/<n>-<slug>/story.json');
const story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
if (!story.design) fail(`#${story.number} has no design comment; the plan implements a design`);
const planText = fs.readFileSync(path.resolve(planPath), 'utf8').replace(/\r\n/g, '\n');
if (/<!--\s*role:/.test(planText)) fail('plan.md holds a role comment, not the plan; write the plan there again');

// Lines with whether each one sits inside a fenced code block (the fence lines themselves count as inside).
const withFences = (text) => {
  let inside = false;
  return text.split('\n').map((line) => {
    const fence = /^\s*(```|~~~)/.test(line);
    const entry = { line, code: inside || fence };
    if (fence) inside = !inside;
    return entry;
  });
};
const heading = ({ line, code }) => (code ? null : line.match(/^(#{1,6})\s+(.*?)\s*$/));

const count = (story.criteria || []).length;
const range = count === 1 ? 'AC1' : `AC1-AC${count}`;
for (const [, n] of planText.matchAll(/\bAC(\d+)\b/g)) {
  if (Number(n) < 1 || Number(n) > count) fail(`AC${n} is mentioned, but the design's criteria are ${range}`);
}

const planLines = withFences(planText.trim());
const levels = planLines.map(heading).filter(Boolean).map((match) => match[1].length);
const shift = levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
const tasks = planLines.map(heading).filter((match) => match && /^Task\s+\d+\b/.test(match[2])).length;
if (!tasks) fail('plan.md has no "Task <n>" headings; give every task one, such as "## Task 1: <name>"');
const plan = planLines.map((entry) => {
  const match = heading(entry);
  return match ? `${'#'.repeat(Math.min(6, match[1].length + shift))} ${match[2]}` : entry.line;
}).join('\n');

const version = story.designVersion || 1;
const comment = [
  `<!-- role:plan design v${version} -->`,
  `## Implementation plan · design v${version}`,
  '<details>',
  `<summary>${tasks} ${tasks === 1 ? 'task' : 'tasks'}</summary>`,
  '',
  plan,
  '',
  '</details>',
].join('\n') + '\n';
if (comment.length > LIMIT) fail(`the comment is ${comment.length} characters, over GitHub's limit of ${LIMIT}; split the story with the developer`);

const commentPath = path.join(dir, 'plan-comment.md');
fs.writeFileSync(commentPath, comment);
console.log(JSON.stringify({ comment: commentPath, designVersion: version, tasks }));
