#!/usr/bin/env node
// Adapted from Tim Lolkema's test-user-story report generator.
// Changes for the design -> build -> test -> review pipeline:
// - acceptance criteria are first-class: every case maps to criteria, the report shows coverage
// - overall status and counts are computed here, never trusted from the input
// - an untested criterion or skipped case makes the run INCOMPLETE instead of PASS/FAILURE
// - writes summary.md next to index.html so the tester agent can post it on the PR unchanged
// - braces in user content are escaped so text like "{{x}}" can't trip the placeholder check
// - summary.md avoids GitHub autolinks: no #<case> numbers, and @tags are wrapped in backticks
const fs = require('fs');
const path = require('path');

const usage = () => {
  console.error('Usage: node <plugin>/skills/test-user-story/references/generate-report.js <evidence-dir>/report-data.json');
  process.exit(1);
};

const fail = (message) => {
  console.error(`report-data.json invalid: ${message}`);
  process.exit(1);
};

const dataPath = process.argv[2];
if (!dataPath) usage();

const absoluteDataPath = path.resolve(dataPath);
const evidenceDir = path.dirname(absoluteDataPath);
const templatePath = path.join(__dirname, 'report.html');
const outputPath = path.join(evidenceDir, 'index.html');
const summaryPath = path.join(evidenceDir, 'summary.md');

const data = JSON.parse(fs.readFileSync(absoluteDataPath, 'utf8'));
const template = fs.readFileSync(templatePath, 'utf8');

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/\{/g, '&#123;')
  .replace(/\}/g, '&#125;');

// Markdown table cells: no pipes or line breaks.
const flat = (value = '') => String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
// Prose: also wrap @words in backticks, so GitHub doesn't turn test tags like @AC1 into user mentions.
const cell = (value = '') => flat(value).replace(/(^|[^\w`])@([A-Za-z0-9][\w-]*)/g, '$1`@$2`');
const code = (value = '') => `\`${flat(value)}\``;
// Statuses as icons in summary.md: passed, failed, or not tested (UNTESTED criterion, SKIPPED case).
const statusIcon = (status) => ({ PASS: '✅', FAIL: '❌' })[status] || '⚠️';

const templateById = (id) => {
  const match = template.match(new RegExp(`<template id="${id}">([\\s\\S]*?)<\\/template>`));
  if (!match) throw new Error(`Missing template: ${id}`);
  return match[1].trim();
};

const replaceAll = (source, replacements) => Object.entries(replacements)
  .reduce((text, [key, value]) => text.split(key).join(value ?? ''), source);

const normalizeStatus = (status) => {
  const normalized = String(status || 'SKIPPED').toUpperCase();
  return ['PASS', 'FAIL', 'SKIPPED'].includes(normalized) ? normalized : 'SKIPPED';
};

const statusClass = (status) => {
  if (status === 'PASS') return 'status-badge-pass';
  if (status === 'FAIL') return 'status-badge-fail';
  return 'status-badge-skipped';
};

// ---------- validate input ----------

const criteria = Array.isArray(data.criteria) ? data.criteria : [];
if (!criteria.length) fail('"criteria" must list the acceptance criteria, e.g. [{ "id": "AC1", "text": "..." }]');
const criterionIds = new Set();
for (const criterion of criteria) {
  if (!criterion || typeof criterion.id !== 'string' || !criterion.id.trim()) fail('every criterion needs a non-empty "id"');
  if (typeof criterion.text !== 'string' || !criterion.text.trim()) fail(`criterion ${criterion.id} needs a non-empty "text"`);
  if (criterionIds.has(criterion.id)) fail(`duplicate criterion id ${criterion.id}`);
  criterionIds.add(criterion.id);
}

const cases = (Array.isArray(data.cases) ? data.cases : []).map((testCase, index) => {
  const status = normalizeStatus(testCase.status);
  const caseCriteria = Array.isArray(testCase.criteria) ? testCase.criteria : [];
  const label = `case ${testCase.number || index + 1}`;
  if (!caseCriteria.length) fail(`${label} must reference at least one criterion id in "criteria"`);
  for (const id of caseCriteria) {
    if (!criterionIds.has(id)) fail(`${label} references unknown criterion "${id}"`);
  }
  if (status === 'FAIL' && (!testCase.expected || !testCase.actual)) {
    fail(`${label} is FAIL and needs "expected" and "actual"`);
  }
  return { ...testCase, number: testCase.number || index + 1, status, criteria: caseCriteria };
});

// Regression tests (the codified cases): each names the cases it came from.
const caseNumbers = new Set(cases.map((testCase) => testCase.number));
const regressionTests = (Array.isArray(data.e2eTests) ? data.e2eTests : []).map((test) => {
  const label = `regression test "${test.title || test.file || '?'}"`;
  const testCases = Array.isArray(test.cases) ? test.cases : [];
  if (!testCases.length) fail(`${label} must list the case numbers it codifies in "cases"`);
  for (const number of testCases) {
    if (!caseNumbers.has(number)) fail(`${label} references unknown case ${number}`);
  }
  return { ...test, cases: testCases };
});

const evidenceEntries = (testCase) => {
  const entries = Array.isArray(testCase.evidence) ? testCase.evidence : [testCase.evidence];
  return entries.filter(Boolean).map((entry) => {
    if (typeof entry === 'string') return { file: entry, step: '' };
    if (typeof entry.file !== 'string' || !entry.file || typeof entry.step !== 'string' || !entry.step.trim()) {
      throw new Error('Evidence objects must contain a filename and a non-empty step name: { file, step }');
    }
    return { file: entry.file, step: entry.step.trim() };
  });
};

for (const testCase of cases) {
  for (const { file } of evidenceEntries(testCase)) {
    const evidencePath = path.join(evidenceDir, file);
    if (!fs.existsSync(evidencePath)) throw new Error(`Referenced evidence file does not exist: ${evidencePath}`);
  }
}

// ---------- compute status (never taken from input) ----------

const coverage = criteria.map((criterion) => {
  const linked = cases.filter((testCase) => testCase.criteria.includes(criterion.id));
  const executed = linked.filter((testCase) => testCase.status !== 'SKIPPED');
  let status = 'UNTESTED';
  if (executed.some((testCase) => testCase.status === 'FAIL')) status = 'FAIL';
  else if (executed.length) status = 'PASS';
  return { ...criterion, cases: linked.map((testCase) => testCase.number), status };
});

const passedCases = cases.filter((testCase) => testCase.status === 'PASS').length;
const failedCases = cases.filter((testCase) => testCase.status === 'FAIL').length;
const skippedCases = cases.filter((testCase) => testCase.status === 'SKIPPED').length;
const untested = coverage.filter((criterion) => criterion.status === 'UNTESTED');
const coveredCriteria = coverage.length - untested.length;

let overallStatus = 'PASS';
if (failedCases) overallStatus = 'FAILURE';
else if (untested.length || skippedCases || !cases.length) overallStatus = 'INCOMPLETE';

if (data.overallStatus && String(data.overallStatus).toUpperCase() !== overallStatus) {
  console.error(`Note: supplied overallStatus "${data.overallStatus}" ignored; computed ${overallStatus}.`);
}

// ---------- HTML ----------

const cardTemplate = templateById('test-case-card-template');
const stepTemplate = templateById('case-step-template');
const videoTemplate = templateById('video-evidence-template');
const imageTemplate = templateById('image-evidence-template');
const caseFailureTemplate = templateById('case-failure-details-template');
const caseConsoleTemplate = templateById('case-console-errors-template');
const chipTemplate = templateById('criterion-chip-template');
const flakyTemplate = templateById('flaky-note-template');
const coverageRowTemplate = templateById('coverage-row-template');

const isVideo = (file) => ['.webm', '.mp4', '.mov'].includes(path.extname(file).toLowerCase());

const evidenceDetails = (testCase) => {
  const entries = evidenceEntries(testCase);
  const files = entries.map((entry) => entry.file);
  const evidenceFile = files.join(', ');

  if (!evidenceFile) {
    return {
      evidenceFile,
      evidenceMedia: '<div class="w-full h-full flex items-center justify-center text-white/80 font-body-sm">No evidence captured</div>',
      playIconVisibility: 'hidden',
    };
  }

  const screenshots = entries.filter((entry) => !isVideo(entry.file)).map((entry, imageIndex) => ({
    src: entry.file,
    step: entry.step,
    alt: entry.step || `${testCase.name || `Case ${testCase.number}`} screenshot ${imageIndex + 1}`,
  }));
  const media = files.filter(isVideo).map((file) => replaceAll(videoTemplate, {
    '{{EVIDENCE_SRC}}': escapeHtml(file),
  }));

  if (screenshots.length) {
    media.push(replaceAll(imageTemplate, {
      '{{EVIDENCE_SRC}}': escapeHtml(screenshots[0].src),
      '{{EVIDENCE_ALT}}': escapeHtml(screenshots[0].alt),
      '{{SCREENSHOTS_JSON}}': escapeHtml(JSON.stringify(screenshots)),
      '{{SCREENSHOT_COUNT}}': String(screenshots.length),
    }));
  }

  return {
    evidenceFile,
    evidenceMedia: media.join('\n'),
    playIconVisibility: screenshots.length || files.length > 1 ? 'hidden' : '',
  };
};

const failureDetails = (testCase) => {
  if (testCase.status !== 'FAIL') return '';
  const consoleErrors = (testCase.consoleErrors || []).length
    ? testCase.consoleErrors.join('\n')
    : 'No JavaScript console errors captured at time of failure.';

  return replaceAll(caseFailureTemplate, {
    '{{CASE_FAILED_STEP}}': escapeHtml(testCase.failedStep || testCase.name || `Case ${testCase.number}`),
    '{{CASE_EXPECTED}}': escapeHtml(testCase.expected),
    '{{CASE_ACTUAL}}': escapeHtml(testCase.actual),
    '{{CASE_CONSOLE_ERRORS_SECTION}}': replaceAll(caseConsoleTemplate, {
      '{{CASE_CONSOLE_ERRORS}}': escapeHtml(consoleErrors),
    }),
  });
};

const cards = cases.map((testCase) => {
  const steps = (testCase.steps || [])
    .map((step, stepIndex) => replaceAll(stepTemplate, {
      '{{STEP_NUMBER}}': String(stepIndex + 1),
      '{{STEP_DESCRIPTION}}': escapeHtml(step),
    }))
    .join('\n');
  const evidence = evidenceDetails(testCase);

  return replaceAll(cardTemplate, {
    '{{CASE_NUMBER}}': String(testCase.number),
    '{{CASE_NAME}}': escapeHtml(testCase.name || `Case ${testCase.number}`),
    '{{CASE_CRITERIA}}': testCase.criteria.map((id) => replaceAll(chipTemplate, { '{{CRITERION_ID}}': escapeHtml(id) })).join(''),
    '{{CASE_GOAL}}': escapeHtml(testCase.goal || ''),
    '{{CASE_FLAKY_NOTE}}': testCase.flaky ? replaceAll(flakyTemplate, { '{{FLAKY_NOTE}}': escapeHtml(testCase.flaky) }) : '',
    '{{CASE_STATUS_CLASS}}': statusClass(testCase.status),
    '{{CASE_STATUS}}': testCase.status,
    '{{CASE_STEPS}}': steps,
    '{{CASE_FAILURE_DETAILS}}': failureDetails(testCase),
    '{{EVIDENCE_MEDIA}}': evidence.evidenceMedia,
    '{{EVIDENCE_PLAY_ICON_VISIBILITY}}': evidence.playIconVisibility,
    '{{EVIDENCE_FILENAME}}': escapeHtml(evidence.evidenceFile || '—'),
  });
}).join('\n');

const coverageRows = coverage.map((criterion) => replaceAll(coverageRowTemplate, {
  '{{CRITERION_ID}}': escapeHtml(criterion.id),
  '{{CRITERION_TEXT}}': escapeHtml(criterion.text),
  '{{CRITERION_CASES}}': criterion.cases.length ? criterion.cases.map((n) => `#${n}`).join(', ') : '—',
  '{{COVERAGE_STATUS_CLASS}}': criterion.status === 'PASS' ? 'status-badge-pass' : criterion.status === 'FAIL' ? 'status-badge-fail' : 'status-badge-skipped',
  '{{COVERAGE_STATUS}}': criterion.status,
})).join('\n');

const issue = data.issue || {};
const issueLabel = issue.number ? `#${issue.number}` : '';
const issueLink = issue.number
  ? (issue.url ? `<a class="underline" href="${escapeHtml(issue.url)}">issue ${escapeHtml(issueLabel)}</a>` : `issue ${escapeHtml(issueLabel)}`)
  : 'no issue';
const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const reportWithoutTemplates = template.replace(/\n\s*<template id="[^"]+">[\s\S]*?<\/template>/g, '');
const report = replaceAll(reportWithoutTemplates, {
  '{{ISSUE_LABEL}}': escapeHtml(issueLabel),
  '{{ISSUE_LINK}}': issueLink,
  '{{BRANCH}}': escapeHtml(data.branch || '—'),
  '{{COMMIT}}': escapeHtml(data.commit || '—'),
  '{{GENERATED_AT}}': escapeHtml(generatedAt),
  '{{STORY_NAME}}': escapeHtml(data.storyName || issue.title || 'User story'),
  '{{OVERALL_STATUS}}': overallStatus,
  '{{OVERALL_STATUS_KEY}}': overallStatus.toLowerCase(),
  '{{ENVIRONMENT}}': escapeHtml(data.environment || ''),
  '{{ENVIRONMENT_URL}}': escapeHtml(data.environmentUrl || ''),
  '{{PASSED_CASES}}': String(passedCases),
  '{{TOTAL_CASES}}': String(cases.length),
  '{{COVERED_CRITERIA}}': String(coveredCriteria),
  '{{TOTAL_CRITERIA}}': String(coverage.length),
  '{{COVERAGE_ROWS}}': coverageRows,
  '{{TEST_CASE_CARDS}}': cards,
});

const remainingPlaceholders = report.match(/{{[^}]+}}/g);
if (remainingPlaceholders) {
  throw new Error(`Unresolved placeholders: ${[...new Set(remainingPlaceholders)].join(', ')}`);
}

// ---------- Markdown summary for the PR comment ----------

const icon = { PASS: '✅', FAILURE: '❌', INCOMPLETE: '⚠️' }[overallStatus];
const md = [];
md.push('<!-- role:test -->');
md.push(`## ${icon} Test ${overallStatus}${issueLabel ? ` · ${issueLabel}` : ''} · ${cell(data.storyName || issue.title || 'User story')}`);
md.push('');
md.push(`**Cases:** ${passedCases}/${cases.length} passed${failedCases ? ` · ${failedCases} failed` : ''}${skippedCases ? ` · ${skippedCases} skipped` : ''}  `);
md.push(`**Criteria tested:** ${coveredCriteria}/${coverage.length}  `);
md.push(`**Environment:** ${cell(data.environment || '—')}${data.environmentUrl ? ` (${cell(data.environmentUrl)})` : ''}  `);
md.push(`**Commit:** ${code(data.commit || '—')} on ${code(data.branch || '—')}`);
md.push('');
md.push('### Acceptance criteria');
md.push('');
md.push('| ID | Criterion | Cases | Status |');
md.push('| --- | --- | --- | --- |');
for (const criterion of coverage) {
  md.push(`| ${cell(criterion.id)} | ${cell(criterion.text)} | ${criterion.cases.length ? criterion.cases.join(',&nbsp;') : '—'} | ${statusIcon(criterion.status)} |`);
}
md.push('');
md.push('### Cases');
md.push('');
md.push('| # | Case | Criteria | Status |');
md.push('| --- | --- | --- | --- |');
for (const testCase of cases) {
  md.push(`| ${testCase.number} | ${cell(testCase.name || '')}${testCase.flaky ? ' ⚠️ flaky' : ''} | ${testCase.criteria.join(', ')} | ${statusIcon(testCase.status)} |`);
}

const failing = cases.filter((testCase) => testCase.status === 'FAIL');
if (failing.length) {
  md.push('');
  md.push('### Failures');
  for (const testCase of failing) {
    md.push('');
    md.push(`**Case ${testCase.number}: ${cell(testCase.name || '')}** (${testCase.criteria.join(', ')})`);
    md.push(`- **Failed step:** ${cell(testCase.failedStep || '—')}`);
    md.push(`- **Expected:** ${cell(testCase.expected)}`);
    md.push(`- **Actual:** ${cell(testCase.actual)}`);
    if ((testCase.steps || []).length) {
      md.push('- **Reproduce:**');
      testCase.steps.forEach((step, i) => md.push(`  ${i + 1}. ${cell(step)}`));
    }
    if ((testCase.consoleErrors || []).length) {
      md.push('');
      md.push('```');
      md.push(testCase.consoleErrors.join('\n').replace(/```/g, "'''"));
      md.push('```');
    }
  }
}

const flaky = cases.filter((testCase) => testCase.flaky);
if (flaky.length) {
  md.push('');
  md.push('### Flakiness findings');
  for (const testCase of flaky) md.push(`- Case ${testCase.number}: ${cell(testCase.name || '')}: ${cell(testCase.flaky)}`);
}

if (regressionTests.length) {
  md.push('');
  md.push('### Regression tests');
  md.push('');
  md.push('| Test | Case | Criteria | Status |');
  md.push('| --- | --- | --- | --- |');
  for (const test of regressionTests) {
    const title = (test.title || '').replace(/@[\w-]+\s*/g, '').trim();
    const testCriteria = ((test.title || '').match(/@AC\d+\b/g) || []).map((tag) => tag.slice(1));
    const icon = /^pass/i.test(String(test.status || '')) ? '✅' : '❌';
    md.push(`| ${cell(title)} | ${test.cases.join(',&nbsp;')} | ${testCriteria.join(', ') || '—'} | ${icon} |`);
  }
  const files = [...new Set(regressionTests.map((test) => test.file).filter(Boolean))];
  const where = [files.length ? `In ${files.map(code).join(', ')}.` : '', data.regressionStability ? `Stable over ${cell(data.regressionStability)}.` : ''].filter(Boolean).join(' ');
  if (where) md.push('', where);
}

md.push('');
md.push('_Full evidence report (screenshots/videos) is kept locally in `' + path.relative(process.cwd(), evidenceDir) + '/index.html`._');

fs.writeFileSync(outputPath, report);
fs.writeFileSync(summaryPath, md.join('\n') + '\n');
console.log(JSON.stringify({ overallStatus, report: outputPath, summary: summaryPath, passedCases, totalCases: cases.length, coveredCriteria, totalCriteria: coverage.length }));
