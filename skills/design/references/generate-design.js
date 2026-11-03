#!/usr/bin/env node
// Turns the design role's drafts (design.md and plan.md) into comment.md, the design comment on the issue.
// - the version comes from story.json (pipeline.js story): the previous design's plus one, or v1
// - design.md has exactly the five sections, in order, none empty
// - the criteria are "- AC<n>: text" lines numbered from 1 without gaps, and every AC<n> mentioned exists
// - the plan's headings are demoted below ##, and it goes in a collapsed block with its task count
// - a comment over GitHub's size limit is refused, never trimmed
const fs = require('fs');
const path = require('path');

const SECTIONS = ['Context', 'Design', 'Acceptance criteria', 'Out of scope', 'Risks and open questions'];
const LIMIT = 65000;

const usage = () => {
  console.error('Usage: node <plugin>/skills/design/references/generate-design.js artifacts/<n>-<slug>/design.md');
  process.exit(1);
};

const fail = (message) => {
  console.error(`design invalid: ${message}`);
  process.exit(1);
};

const designPath = process.argv[2];
if (!designPath) usage();

const dir = path.dirname(path.resolve(designPath));
const read = (name, hint) => {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fail(`no ${name} next to design.md; ${hint}`);
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
};

const designText = fs.readFileSync(path.resolve(designPath), 'utf8').replace(/\r\n/g, '\n');
const planText = read('plan.md', 'write the approved plan there');
const story = JSON.parse(read('story.json', 'save it with pipeline.js story <n> > artifacts/<n>-<slug>/story.json'));
if (/<!--\s*role:design\b/.test(planText)) fail('plan.md holds a design comment, not the plan; write the approved plan there again');

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

// ---------- design.md: the five sections ----------

const sections = [];
for (const entry of withFences(designText)) {
  const match = heading(entry);
  if (match && match[1].length === 2) sections.push({ name: match[2], lines: [] });
  else if (sections.length) sections[sections.length - 1].lines.push(entry.line);
  else if (entry.line.trim() && !(match && match[1].length === 1)) fail(`"${entry.line.trim()}" comes before ## Context; only a # title may`);
}
const names = sections.map((section) => section.name);
if (names.join('|') !== SECTIONS.join('|')) fail(`the sections must be ${SECTIONS.join(', ')}; found ${names.join(', ') || 'none'}`);
for (const section of sections) {
  section.body = section.lines.join('\n').trim();
  if (!section.body) fail(`"${section.name}" is empty`);
}
// pipeline.js reads the criteria under the first heading of any level called "Acceptance criteria".
for (const section of sections.slice(0, 2)) {
  const early = withFences(section.body).map(heading).find((match) => match && /^acceptance criteria\b/i.test(match[2]));
  if (early) fail(`"${early[0]}" in ${section.name}; the criteria parser would read it instead of the Acceptance criteria section, so rename it`);
}

const criteria = sections[2].body.split('\n').filter((line) => line.trim()).map((line, index) => {
  const match = line.match(/^- AC(\d+): (\S.*)$/);
  if (!match) fail(`"${line.trim()}" under Acceptance criteria; that section holds only "- AC<n>: text" lines`);
  if (Number(match[1]) !== index + 1) fail(`criterion ${index + 1} is numbered AC${match[1]}; number them AC1, AC2, ... without gaps`);
  return match[2];
});

const range = criteria.length === 1 ? 'AC1' : `AC1-AC${criteria.length}`;
for (const [, n] of `${designText}\n${planText}`.matchAll(/\bAC(\d+)\b/g)) {
  if (Number(n) < 1 || Number(n) > criteria.length) fail(`AC${n} is mentioned, but the criteria are ${range}`);
}

// ---------- plan.md: demoted, counted ----------

const planLines = withFences(planText.trim());
const levels = planLines.map(heading).filter(Boolean).map((match) => match[1].length);
const shift = levels.length ? Math.max(0, 3 - Math.min(...levels)) : 0;
const tasks = planLines.map(heading).filter((match) => match && /^Task\s+\d+\b/.test(match[2])).length;
if (!tasks) fail('plan.md has no "Task <n>" headings; give every task one, such as "## Task 1: <name>"');
const plan = planLines.map((entry) => {
  const match = heading(entry);
  return match ? `${'#'.repeat(Math.min(6, match[1].length + shift))} ${match[2]}` : entry.line;
}).join('\n');

// ---------- comment.md ----------

const version = story.design ? (story.designVersion || 1) + 1 : 1;
const comment = [
  `<!-- role:design v${version} -->`,
  sections.map((section) => `## ${section.name}\n${section.body}`).join('\n\n'),
  '',
  '## Implementation plan',
  '<details>',
  `<summary>${tasks} ${tasks === 1 ? 'task' : 'tasks'}</summary>`,
  '',
  plan,
  '',
  '</details>',
].join('\n') + '\n';
if (comment.length > LIMIT) fail(`the comment is ${comment.length} characters, over GitHub's limit of ${LIMIT}; shorten the design or the plan with the developer`);

const commentPath = path.join(dir, 'comment.md');
fs.writeFileSync(commentPath, comment);
console.log(JSON.stringify({ comment: commentPath, designVersion: version, criteria: criteria.length, tasks }));
