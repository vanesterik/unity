#!/usr/bin/env node
// Turns the review role's review-data.json into review.md, the PR review comment.
// - the verdict and every count are computed here, never trusted from the input
// - a criterion not met or a failed test run needs a blocking finding, so the verdict can't contradict the tables
// - every criterion of the design is reviewed: the count comes from the design, not from the review
// - review.md avoids GitHub autolinks and mentions: @words are wrapped in backticks
const fs = require('fs');
const path = require('path');

const usage = () => {
  console.error('Usage: node <plugin>/skills/review/references/generate-review.js artifacts/<n>-<slug>/review-data.json');
  process.exit(1);
};

const fail = (message) => {
  console.error(`review-data.json invalid: ${message}`);
  process.exit(1);
};

const dataPath = process.argv[2];
if (!dataPath) usage();

const absoluteDataPath = path.resolve(dataPath);
const reviewPath = path.join(path.dirname(absoluteDataPath), 'review.md');
const data = JSON.parse(fs.readFileSync(absoluteDataPath, 'utf8'));

// Markdown table cells: no pipes or line breaks.
const flat = (value = '') => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
// Wrap @words in backticks, so GitHub doesn't turn @AC1 into a user mention.
const mentions = (value = '') => String(value).replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, '$1`@$2`');
const cell = (value = '') => mentions(flat(value));
const code = (value = '') => `\`${flat(value)}\``;
// A code reference: file:line or file:line-line, nothing else.
const isReference = (value) => typeof value === 'string' && /^[^\s:]+:\d+(-\d+)?$/.test(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

// ---------- validate input ----------

const issue = data.issue || {};
if (!Number.isInteger(issue.number) || !nonEmpty(issue.title)) fail('"issue" needs a "number" and a "title"');
if (!nonEmpty(data.commit)) fail('"commit" is required');
if (!Number.isInteger(data.designVersion)) fail('"designVersion" must be the design version number, e.g. 1');

if (!Number.isInteger(data.designCriteria) || data.designCriteria < 1) fail('"designCriteria" must be the number of criteria in the design, from story');
const criteria = Array.isArray(data.criteria) ? data.criteria : [];
if (criteria.length !== data.designCriteria) fail(`the design has ${data.designCriteria} criteria and the review lists ${criteria.length}; review every one`);
criteria.forEach((criterion, index) => {
  const expected = `AC${index + 1}`;
  if (!criterion || criterion.id !== expected) fail(`criteria must be AC1, AC2, ... in order; entry ${index + 1} is "${criterion && criterion.id}", expected ${expected}`);
  if (typeof criterion.met !== 'boolean') fail(`${expected} needs "met": true or false`);
  const where = Array.isArray(criterion.where) ? criterion.where : [];
  if (criterion.met && !where.length) fail(`${expected} is met and needs the code that meets it in "where"`);
  for (const reference of where) {
    if (!isReference(reference)) fail(`${expected} "where" holds "${reference}"; use file:line or file:line-line only`);
  }
});

const findings = (key) => (Array.isArray(data[key]) ? data[key] : []).map((finding, index) => {
  const label = `${key} ${index + 1}`;
  if (!finding || !nonEmpty(finding.title)) fail(`${label} needs a "title"`);
  if (!isReference(finding.where)) fail(`${label} needs "where" as file:line or file:line-line`);
  if (!nonEmpty(finding.body)) fail(`${label} needs a "body"`);
  return finding;
});
const blocking = findings('blocking');
const suggestions = findings('suggestions');

const tests = data.tests || {};
const extra = Object.keys(tests).filter((kind) => kind !== 'unit');
if (extra.length) fail(`${extra.map((kind) => `"tests.${kind}"`).join(', ')} not allowed: the reviewer runs the unit tests only; /unity:test owns integration and E2E tests`);
const runs = ['unit'].map((kind) => {
  const run = tests[kind] || {};
  if (!Number.isInteger(run.passed) || !Number.isInteger(run.total) || run.passed > run.total) {
    fail(`"tests.${kind}" needs whole numbers "passed" and "total", with passed <= total`);
  }
  return { kind, ...run };
});

const unmet = criteria.filter((criterion) => !criterion.met);
const failedRuns = runs.filter((run) => run.passed < run.total);
if ((unmet.length || failedRuns.length) && !blocking.length) {
  const reasons = [...unmet.map((criterion) => `${criterion.id} is not met`), ...failedRuns.map((run) => `${run.kind} tests failed`)];
  fail(`${reasons.join(', ')}, so at least one blocking finding must say why`);
}

const declined = (Array.isArray(data.declined) ? data.declined : []).map((entry, index) => {
  if (!entry || !nonEmpty(entry.behaviour) || !nonEmpty(entry.reason)) fail(`declined ${index + 1} needs a "behaviour" and a "reason"`);
  return entry;
});

// ---------- compute the verdict (never taken from input) ----------

const verdict = blocking.length ? 'CHANGES REQUESTED' : 'APPROVE';
if (data.verdict && String(data.verdict).toUpperCase() !== verdict) {
  console.error(`Note: supplied verdict "${data.verdict}" ignored; computed ${verdict}.`);
}

// ---------- Markdown for the PR review comment ----------

const findingList = (list) => {
  if (!list.length) return ['None.'];
  return list.flatMap((finding, index) => [
    `${index + 1}. **${cell(finding.title)}** · ${code(finding.where)}`,
    `   ${cell(finding.body)}`,
  ]);
};

const md = [];
md.push('<!-- role:review -->');
// The heading carries the verdict as an icon, as the tables do: ✅ approved, ❌ changes requested.
md.push(`## ${blocking.length ? '❌' : '✅'} Review`);
md.push('');
md.push(`**Design:** v${data.designVersion}  `);
md.push(`**Criteria met:** ${criteria.length - unmet.length}/${criteria.length}  `);
md.push(`**Findings:** ${blocking.length} blocking, ${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}  `);
md.push(`**Tests run:** ${runs.map((run) => `${run.kind} ${run.passed}/${run.total}`).join(', ')}  `);
md.push(`**Commit:** ${code(data.commit.trim().slice(0, 7))}`);
md.push('');
md.push('### Acceptance criteria');
md.push('');
md.push('| Criterion | Where | Status |');
md.push('| --- | --- | --- |');
for (const criterion of criteria) {
  const where = (criterion.where || []).map(code).join(', ') || '—';
  md.push(`| ${criterion.id} | ${where} | ${criterion.met ? '✅' : '❌'} |`);
}
md.push('');
md.push('### Blocking');
md.push('');
md.push(...findingList(blocking));
md.push('');
md.push('### Suggestions');
md.push('');
md.push(...findingList(suggestions));
md.push('');
md.push('### Strengths');
md.push('');
md.push(nonEmpty(data.strengths) ? mentions(data.strengths.trim()) : 'None.');
md.push('');
md.push('### Declined to judge');
md.push('');
md.push(...(declined.length ? declined.map((entry) => `- ${cell(entry.behaviour)}: ${cell(entry.reason)}`) : ['None.']));

fs.writeFileSync(reviewPath, md.join('\n') + '\n');
console.log(JSON.stringify({ verdict, review: reviewPath, criteriaMet: criteria.length - unmet.length, totalCriteria: criteria.length, blocking: blocking.length, suggestions: suggestions.length }));
