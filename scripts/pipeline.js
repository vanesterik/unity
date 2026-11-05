#!/usr/bin/env node
// Pipeline helper for the design -> build -> test -> review flow.
// All GitHub access goes through the gh CLI (needs: gh auth refresh -s project).
// Lives in the unity plugin; per-project settings are read from <project>/.claude/pipeline.json.
// Skills call it as: node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" <command>
//
//   pipeline.js init <owner> <project-number>   discover project/field/option IDs into .claude/pipeline.json
//   pipeline.js resolve [arg]                   print the issue number (arg, #n, URL, or current branch)
//   pipeline.js story [arg]                     issue + latest design + acceptance criteria as JSON
//   pipeline.js design [arg]                    the latest design comment, as markdown (without an older comment's plan)
//   pipeline.js check-design <issue> <file>     exit 1 unless the latest design comment is the generated comment.md
//   pipeline.js comments <issue> <role>         latest <!-- role:<role> --> comment on the issue or its PR, as JSON
//   pipeline.js pr <issue>                      the open PR for the issue (number, url, branch, head SHA), as JSON
//   pipeline.js tested <issue>                  latest test result and whether it still covers the PR head, as JSON
//   pipeline.js queue <Column>                  issues of this repo in a board column, as JSON
//   pipeline.js check <issue> <Column>          exit 1 unless the issue is in this column; prints its column as JSON
//   pipeline.js status <issue> <Column>         move the issue's project item to a column
//   pipeline.js port <issue>                    deterministic local port for this issue's test environment
//   pipeline.js board [--markdown]              every board issue per column, with PR, latest result, next step and warnings, as JSON
//                                               (--markdown: the overview /unity:status prints)
//   pipeline.js summary <issue> [--since <ISO time>] [--markdown]
//                                               the build, test and review results posted since the time, with the column
//                                               and next step, as JSON (--markdown: the summary /unity:ship prints)
//   pipeline.js pointer <issue> <role> [--post] the one-line pointer to the role's latest output, for the issue timeline
//                                               (--post: post it on the issue)
//   pipeline.js merge <issue> [--check]         merge the PR with a rebase when tested and approved on its head and CI is green
//                                               (waits up to 8 minutes for running checks); exit 1 with the reasons otherwise
//                                               (--check: only report, never merge or wait)
//   pipeline.js reworks <issue> --since <time>  the builder's reworks on the issue since the time, and the limit, as JSON
//   pipeline.js stop <issue> --reason <text> [--url <url>]
//                                               label the issue autopilot:stopped, move it from Build to Design, and comment why
//   pipeline.js resume                          what an autopilot run does with stories earlier runs stopped at, as JSON:
//                                               the one to resume, the labels cleared, and the stories that block the run
//   pipeline.js digest --since <time> [--stopped <issue>] [--blocked] [--markdown]
//                                               what an autopilot run merged, where it stopped and what waits in Build, as JSON
//                                               (--markdown: the digest /unity:autopilot prints)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = () => {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
};
const root = projectRoot();
const configPath = path.join(root, '.claude', 'pipeline.json');

const die = (message) => { console.error(message); process.exit(1); };
const gh = (args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const ghJson = (args) => JSON.parse(gh(args) || 'null');
const git = (args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const currentBranch = () => git(['branch', '--show-current']) || git(['rev-parse', '--abbrev-ref', 'HEAD']);

// The project's .claude/pipeline.json, or {} when it doesn't exist yet.
const readConfig = () => (fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {});

const loadConfig = () => {
  if (!fs.existsSync(configPath)) die(`Missing ${configPath}. Run /unity:init <owner> <project-number> in this project.`);
  return readConfig();
};

const currentRepo = () => gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);

// ---------- issue resolution ----------

const resolveIssue = (arg) => {
  const text = String(arg || '').trim();
  let match = text.match(/^#?(\d+)$/) || text.match(/\/issues\/(\d+)/) || text.match(/\/pull\/(\d+)/);
  if (match) {
    if (/\/pull\//.test(text)) return issueFromPr(match[1]);
    return Number(match[1]);
  }
  const branch = currentBranch();
  match = branch.match(/^(?:feature|fix|chore)\/(\d+)-/);
  if (match) return Number(match[1]);
  return null;
};

const issueFromPr = (pr) => {
  const body = gh(['pr', 'view', String(pr), '--json', 'body', '-q', '.body']);
  const match = body.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (!match) die(`PR #${pr} has no "Closes #<issue>" line`);
  return Number(match[1]);
};

// ---------- design + acceptance criteria parsing ----------

// Latest entry ({ body, createdAt, ... }) whose body carries <!-- role:<role> ... -->, or null.
const latestRoleComment = (entries, role) => {
  const marker = new RegExp(`<!--\\s*role:${role}(?=\\s|-->)`);
  const matches = entries.filter((entry) => marker.test(entry.body || ''));
  matches.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return matches.length ? matches[matches.length - 1] : null;
};

// The design as the builder's spec: an older design comment still carries the designer's
// Implementation plan, written against an older main; the builder plans afresh, so it is cut off.
const designSpec = (body) => {
  const at = body.search(/^## Implementation plan\s*$/m);
  return at === -1 ? body : `${body.slice(0, at).trimEnd()}\n`;
};

// Version number from a <!-- role:design v<n> --> marker; a marker without one is version 1.
const designVersion = (body) => Number((body.match(/role:design\s+v(\d+)/) || [])[1] || 1);

const parseCriteria = (markdown = '') => {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s*acceptance criteria\b/i.test(line.trim()));
  if (start === -1) return [];
  const criteria = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const match = line.match(/^\s*[-*]\s*(?:\[[ xX]\]\s*)?\**(AC\d+)\**\s*[:.)\-–]\s*(.+?)\s*$/);
    if (match) criteria.push({ id: match[1], text: match[2] });
  }
  return criteria;
};

const story = (arg) => {
  const number = resolveIssue(arg);
  if (!number) die('Could not determine the issue. Pass a number, or run on a feature/<n>-<slug> branch.');
  const issue = ghJson(['issue', 'view', String(number), '--json', 'number,title,url,body,state,comments']);
  const design = latestRoleComment(issue.comments || [], 'design');
  let criteria = design ? parseCriteria(design.body) : [];
  let criteriaSource = design ? 'design-comment' : null;
  if (!criteria.length) {
    criteria = parseCriteria(issue.body);
    criteriaSource = criteria.length ? 'issue-body' : null;
  }
  const branch = currentBranch();
  const found = findPr(number);
  const pr = found ? { number: found.number, url: found.url, headRefName: found.headRefName } : null;
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    body: issue.body,
    design: design ? design.body : null,
    designVersion: design ? designVersion(design.body) : null,
    criteria,
    criteriaSource,
    branch,
    commit: git(['rev-parse', '--short', 'HEAD']),
    pr,
  };
};

// Null when the posted design comment is the generated comment.md, otherwise the first line
// that differs. Line endings and trailing whitespace don't count: GitHub may change them.
const compareComment = (posted, generated) => {
  if (posted === null || posted === undefined) return 'the issue has no design comment';
  const lines = (text) => text.replace(/\r\n/g, '\n').trimEnd().split('\n').map((line) => line.trimEnd());
  const a = lines(posted);
  const b = lines(generated);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return `line ${i + 1} differs: posted "${a[i] || ''}", generated "${b[i] || ''}"`;
  }
  return null;
};

// Exits non-zero unless the issue's latest design comment is the generated comment.md.
const checkDesign = (issueArg, file) => {
  const number = resolveIssue(issueArg);
  if (!number || !file) die('Usage: pipeline.js check-design <issue> artifacts/<n>-<slug>/comment.md');
  const result = story(number);
  const difference = compareComment(result.design, fs.readFileSync(path.resolve(file), 'utf8'));
  if (difference) die(`#${number}'s latest design comment is not ${file}: ${difference}`);
  return { number, designVersion: result.designVersion, criteria: result.criteria.length, criteriaSource: result.criteriaSource };
};

// ---------- pull request + role comments ----------

// The PR whose body closes the issue, or null.
const prForIssue = (prs, number) => prs.find((p) => new RegExp(`(closes|fixes|resolves)\\s+#${number}\\b`, 'i').test(p.body || '')) || null;

// The issue number a PR body closes, or null.
const closesIssue = (body) => Number((String(body || '').match(/(?:closes|fixes|resolves)\s+#(\d+)/i) || [])[1]) || null;

// Lists the open PRs instead of searching them: GitHub's search index can lag behind a PR that was
// just opened. No PR yet is an empty list; a gh failure (auth, network) throws, so it is never
// mistaken for "no PR".
const findPr = (number) => {
  const prs = ghJson(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,url,headRefName,headRefOid,body,createdAt']);
  return prForIssue(prs || [], number);
};

const pr = (issueArg) => {
  const number = resolveIssue(issueArg);
  if (!number) die('Usage: pipeline.js pr <issue>');
  const found = findPr(number);
  return found ? { number: found.number, url: found.url, branch: found.headRefName, headSha: found.headRefOid } : null;
};

// Role output can sit in an issue comment, the PR body, a PR comment or a PR review body.
// Pass the issue's PR when the caller already looked it up, to save the lookup.
const comments = (issueArg, role, knownPr) => {
  const number = resolveIssue(issueArg);
  if (!number || !role) die('Usage: pipeline.js comments <issue> <role>');
  return latestRoleComment(roleEntries(number, knownPr === undefined ? findPr(number) : knownPr), role);
};

// The issue's comments and its PR's body, comments and reviews, fetched once per issue.
const entriesCache = new Map();
const roleEntries = (number, found) => {
  if (entriesCache.has(number)) return entriesCache.get(number);
  const issue = ghJson(['issue', 'view', String(number), '--json', 'comments']);
  const entries = (issue.comments || []).map((c) => ({ source: 'issue-comment', body: c.body, createdAt: c.createdAt, url: c.url }));
  if (found) {
    entries.push({ source: 'pr-body', body: found.body, createdAt: found.createdAt, url: found.url });
    const detail = ghJson(['pr', 'view', String(found.number), '--json', 'comments,reviews']);
    for (const c of detail.comments || []) entries.push({ source: 'pr-comment', body: c.body, createdAt: c.createdAt, url: c.url });
    for (const r of detail.reviews || []) entries.push({ source: 'pr-review', body: r.body, createdAt: r.submittedAt, url: found.url });
  }
  entriesCache.set(number, entries);
  return entries;
};

// ---------- test result vs. PR head ----------

// Status and tested commit from a summary.md written by the report generator.
// The outcome a test or review post carries as the icon in its heading (## ✅ Test, ## ❌ Review).
// ⚠ may come with or without its variation selector.
const headingIcon = (body, role) => {
  const icon = ((body || '').match(new RegExp(`^##\\s+(✅|❌|⚠\uFE0F?)\\s+${role}\\s*$`, 'mu')) || [])[1];
  return icon ? icon.replace('\uFE0F', '') : null;
};
const TEST_STATUS = { '✅': 'PASS', '❌': 'FAILURE', '⚠': 'INCOMPLETE' };
const REVIEW_VERDICT = { '✅': 'APPROVE', '❌': 'CHANGES REQUESTED' };

const reviewVerdict = (body = '') => REVIEW_VERDICT[headingIcon(body, 'Review')] || null;

// A rework post: whose findings it answers and its counts, or null for any other post.
const reworkOf = (body = '') => {
  if (!/^##\s+Rework\s*$/m.test(body)) return null;
  const value = (name) => (body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s+(.+?)\\s*$`, 'm')) || [])[1] || null;
  const role = value('Findings of');
  return { role: /^(test|review)$/.test(role || '') ? role : null, fixed: Number(value('Fixed')) || 0, notFixed: Number(value('Not fixed')) || 0 };
};

const parseTestSummary = (body = '') => ({
  status: TEST_STATUS[headingIcon(body, 'Test')] || null,
  commit: (body.match(/\*\*Commit:\*\*\s+`([0-9a-f]{7,40})`/) || [])[1] || null,
});

// Files that are not under any of the path prefixes.
const outsidePaths = (files, prefixes) => files.filter((file) => !prefixes.some((prefix) => {
  const clean = prefix.replace(/\/$/, '');
  return file === clean || file.startsWith(`${clean}/`);
}));

// Whether the latest test result still covers the PR: commits after the tested one may only
// touch the test role's own paths (the tests it committed after testing).
const tested = (issueArg) => {
  const number = resolveIssue(issueArg);
  if (!number) die('Usage: pipeline.js tested <issue>');
  const found = findPr(number);
  if (!found) die(`#${number} has no open PR`);
  return testCoverage(found, comments(number, 'test', found));
};

const testCoverage = (found, report) => {
  const { status, commit } = parseTestSummary(report ? report.body : '');
  const result = { status, testedCommit: commit, headSha: found.headRefOid, reportUrl: report ? report.url : null, changedSince: [], outsideTestPaths: [] };
  if (!commit) return { ...result, covers: false };
  const compare = ghJson(['api', `repos/{owner}/{repo}/compare/${commit}...${found.headRefOid}`]);
  const config = readConfig();
  const testPaths = ((config.test && config.test.writablePaths) || []).filter((p) => !/^artifacts\/?$/.test(p));
  result.changedSince = (compare.files || []).map((file) => file.filename);
  result.outsideTestPaths = outsidePaths(result.changedSince, testPaths);
  const contained = compare.status === 'ahead' || compare.status === 'identical';
  return { ...result, covers: status === 'PASS' && contained && !result.outsideTestPaths.length };
};

// ---------- board overview ----------

// The newest role result among the entries, with its status and commit: a test or review
// summary, or else the build's PR body or rework comment.
const latestResult = (entries) => {
  const newest = ['test', 'review']
    .map((role) => [role, latestRoleComment(entries, role)])
    .filter(([, entry]) => entry)
    .sort(([, a], [, b]) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .pop();
  if (newest) {
    const [role, entry] = newest;
    const status = role === 'test' ? parseTestSummary(entry.body).status : reviewVerdict(entry.body);
    const commit = (entry.body.match(/\*\*Commit:\*\*\s+`([0-9a-f]{7,40})`/) || [])[1] || null;
    return { role, status, commit, url: entry.url };
  }
  const build = latestRoleComment(entries, 'build');
  return build ? { role: 'build', status: null, commit: null, url: build.url } : null;
};

// Whether a result was given on the PR's current head.
const onHead = (latest, pr) => Boolean(latest && latest.commit && pr && pr.headSha && pr.headSha.startsWith(latest.commit));

// The command to run next for an issue, from its column and its latest result.
const nextStep = (issue) => {
  const { number, column, pr, latest } = issue;
  if (column === 'Backlog' || column === 'Design') return `/unity:design ${number}`;
  if (column === 'Test' && latest && latest.role === 'test' && latest.status === 'INCOMPLETE' && onHead(latest, pr)) return 'decide on the untested criteria';
  if (column === 'Review' && latest && latest.role === 'review' && latest.status === 'APPROVE' && onHead(latest, pr)) return 'ready to merge';
  if (column === 'Build' || column === 'Test' || column === 'Review') return `/unity:ship ${number}`;
  return null;
};

// What needs the developer's attention beyond the columns.
const boardWarnings = ({ issues, openPrs, mergedPrs, openIssues }) => {
  const warnings = [];
  for (const issue of issues) {
    if (issue.column !== 'Review' || !issue.coverage || issue.coverage.covers) continue;
    const { testedCommit, outsideTestPaths } = issue.coverage;
    const message = testedCommit
      ? `#${issue.number} is in Review, but its test result on \`${testedCommit}\` no longer covers the PR head${outsideTestPaths.length ? `: ${outsideTestPaths.join(', ')} changed` : ''}`
      : `#${issue.number} is in Review with no passing test result on its PR`;
    warnings.push({ type: 'stale-test', issue: issue.number, message });
  }
  const onBoard = new Set(issues.map((issue) => issue.number));
  for (const p of openPrs) {
    const closes = closesIssue(p.body);
    if (closes && onBoard.has(closes)) continue;
    const message = closes ? `PR #${p.number} closes #${closes}, which is not on the board: ${p.url}` : `PR #${p.number} closes no issue: ${p.url}`;
    warnings.push({ type: 'pr-without-issue', pr: p.number, message });
  }
  const open = new Map(openIssues.map((issue) => [issue.number, issue]));
  for (const p of mergedPrs) {
    const closes = closesIssue(p.body);
    if (!closes || !open.has(closes)) continue;
    warnings.push({ type: 'merged-but-open', issue: closes, pr: p.number, message: `#${closes} is still open, but PR #${p.number} that closes it is merged: ${p.url}` });
  }
  return warnings;
};

const RESULT_ICONS = { PASS: '✅', APPROVE: '✅', FAILURE: '❌', 'CHANGES REQUESTED': '❌', INCOMPLETE: '⚠️' };

const formatResult = (latest) => {
  if (!latest) return 'no result yet';
  if (latest.role === 'build') return '🔨 Built';
  const role = latest.role === 'test' ? 'Test' : 'Review';
  return `${RESULT_ICONS[latest.status] || '❔'} ${role} ${latest.status || 'unknown'}${latest.commit ? ` on \`${latest.commit}\`` : ''}`;
};

const formatNext = (next) => (next && next.startsWith('/') ? `\`${next}\`` : next);

// The board overview as markdown, the same for the same board: the issues per column (Done only
// as a count), the empty columns on one line, then the warnings.
const formatBoard = ({ columns, warnings }) => {
  const blocks = [];
  const open = columns.filter((column) => column.name !== 'Done');
  for (const column of open.filter((c) => c.issues.length)) {
    const lines = [`**${column.name}** (${column.issues.length})`];
    for (const issue of column.issues) {
      const parts = [`#${issue.number} ${issue.title}`];
      if (issue.pr) parts.push(`PR #${issue.pr.number}${issue.pr.draft ? ' (draft)' : ''}`, formatResult(issue.latest));
      lines.push(`- ${parts.join(' · ')}${issue.next ? ` → ${formatNext(issue.next)}` : ''}`);
    }
    blocks.push(lines.join('\n'));
  }
  if (!blocks.length) blocks.push('Nothing in progress.');
  const empty = open.filter((c) => !c.issues.length).map((c) => c.name);
  const done = columns.find((c) => c.name === 'Done');
  blocks.push([empty.length ? `Empty: ${empty.join(', ')}` : null, `Done: ${done ? done.issues.length : 0}`].filter(Boolean).join(' · '));
  if (warnings.length) {
    blocks.push(['**Warnings**', ...warnings.map((w) => `- ⚠️ ${w.message}`)].join('\n'));
    const merged = warnings.filter((w) => w.type === 'merged-but-open').map((w) => `#${w.issue}`);
    if (merged.length) blocks.push(`Close ${merged.join(', ')} by hand, with a comment saying which pull request delivered it and how each acceptance criterion was met.`);
  }
  return blocks.join('\n\n');
};

// ---------- issue pointers ----------

// The one-line pointer a role leaves on the issue, from the role output it posted: the
// generated PR body or rework comment, test summary or review. Throws on output the
// generators didn't write, so a pointer never guesses.
const formatPointer = (role, entry) => {
  const body = entry.body || '';
  if (role === 'build') {
    const rework = reworkOf(body);
    if (rework) return `🔨 Reworked ${rework.role} findings: ${entry.url}`;
    const commits = Number((body.match(/^\*\*Commits:\*\*\s+(\d+)/m) || [])[1]);
    const unit = body.match(/^\*\*Unit tests:\*\*\s+(\d+)\/(\d+)/m);
    if (!commits || !unit) throw new Error('The build output has no commit or unit test counts; write the PR body with generate-build.js');
    return `🔨 Built: ${entry.url} (${commits} ${commits === 1 ? 'commit' : 'commits'}, unit tests ${unit[1]}/${unit[2]})`;
  }
  if (role === 'test') {
    const { status, commit } = parseTestSummary(body);
    if (!status || !commit) throw new Error('The test output has no status or commit; post the summary.md that generate-report.js wrote');
    return `${RESULT_ICONS[status]} Test ${status} on \`${commit}\`: ${entry.url}`;
  }
  if (role === 'review') {
    const verdict = reviewVerdict(body);
    if (!verdict) throw new Error('The review output has no verdict; post the review.md that generate-review.js wrote');
    return `${RESULT_ICONS[verdict]} Review ${verdict}: ${entry.url}`;
  }
  throw new Error(`No pointer for role "${role}"; use build, test or review`);
};

// The pointer for the role's latest output on the issue or its PR.
const pointer = (issueArg, role) => {
  const number = resolveIssue(issueArg);
  if (!number || !role) die('Usage: pipeline.js pointer <issue> <build|test|review>');
  const entry = comments(number, role);
  if (!entry) die(`#${number} has no ${role} output on the issue or its PR`);
  return formatPointer(role, entry);
};

// ---------- ship summary ----------

const field = (body, name) => (body.match(new RegExp(`^\\*\\*${name}:\\*\\*\\s+(.+?)\\s*$`, 'm')) || [])[1] || null;

// One line for a role's output, with the counts its generator wrote.
const resultLine = (role, body) => {
  if (role === 'build') {
    const rework = reworkOf(body);
    if (rework) return `🔨 Rework of ${rework.role} findings: ${rework.fixed} fixed, ${rework.notFixed} not fixed`;
    const commits = Number((field(body, 'Commits') || '').match(/^\d+/));
    const unit = (field(body, 'Unit tests') || '').match(/^(\d+\/\d+)/);
    return `🔨 Build${commits && unit ? `: ${commits} ${commits === 1 ? 'commit' : 'commits'}, unit tests ${unit[1]}` : ''}`;
  }
  const { commit } = parseTestSummary(body);
  const on = commit ? ` on \`${commit}\`` : '';
  if (role === 'test') {
    const { status } = parseTestSummary(body);
    const criteria = (field(body, 'Criteria tested') || '').match(/^\d+\/\d+/);
    const cases = (field(body, 'Cases') || '').match(/^\d+\/\d+ passed/);
    const counts = [criteria && `${criteria[0]} criteria tested`, cases && `${cases[0].replace(' passed', '')} cases passed`].filter(Boolean);
    return `${RESULT_ICONS[status] || '❔'} Test ${status || 'unknown'}${on}${counts.length ? `: ${counts.join(', ')}` : ''}`;
  }
  const verdict = reviewVerdict(body);
  const criteria = (field(body, 'Criteria met') || '').match(/^\d+\/\d+/);
  const findings = field(body, 'Findings');
  const counts = [criteria && `${criteria[0]} criteria met`, findings].filter(Boolean);
  return `${RESULT_ICONS[verdict] || '❔'} Review ${verdict || 'unknown'}${on}${counts.length ? `: ${counts.join(', ')}` : ''}`;
};

// The latest build, test and review output posted since the run started (an ISO time; all
// when omitted), oldest first.
const runResults = (entries, since) => {
  const start = since ? Date.parse(since) : -Infinity;
  const inRun = entries.filter((entry) => Date.parse(entry.createdAt) >= start);
  return ['build', 'test', 'review']
    .map((role) => [role, latestRoleComment(inRun, role)])
    .filter(([, entry]) => entry)
    .sort(([, a], [, b]) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map(([role, entry]) => {
      const result = { role, line: resultLine(role, entry.body || ''), url: entry.url };
      // The test summary names the local evidence report, which never leaves the tester's machine.
      const report = role === 'test' && ((entry.body || '').match(/kept locally in `([^`]+\.html)`/) || [])[1];
      return report ? { ...result, report } : result;
    });
};

// The commits a role vouched for, in the order they were posted: a build handover (the PR body
// or a rework comment), a passing test, an approval.
const signOffs = (entries) => entries
  .map((entry) => {
    const body = entry.body || '';
    const commit = (body.match(/\*\*Commit:\*\*\s+`([0-9a-f]{7,40})`/) || [])[1];
    if (!commit) return null;
    if (/<!--\s*role:build(?=\s|-->)/.test(body)) return { role: 'build', commit, createdAt: entry.createdAt };
    if (/<!--\s*role:test(?=\s|-->)/.test(body) && parseTestSummary(body).status === 'PASS') return { role: 'test', commit, createdAt: entry.createdAt };
    if (/<!--\s*role:review(?=\s|-->)/.test(body) && reviewVerdict(body) === 'APPROVE') return { role: 'review', commit, createdAt: entry.createdAt };
    return null;
  })
  .filter(Boolean)
  .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  .map(({ role, commit }) => ({ role, commit }));

// The PR's commits (oldest first) after the newest sign-off up to the stopping commit (the PR head
// when there is none): what changed since a role last vouched for the code.
const changesSince = ({ commits, signOffs: offs, stopAt }) => {
  const at = (sha) => commits.findIndex((commit) => commit.sha.startsWith(sha) || sha.startsWith(commit.sha));
  const stop = stopAt && at(stopAt) !== -1 ? at(stopAt) : commits.length - 1;
  let since = null;
  let from = -1;
  for (const off of offs) {
    const index = at(off.commit);
    if (index !== -1 && index <= stop && index >= from) { since = off; from = index; }
  }
  return {
    since: since && { role: since.role, commit: since.commit.slice(0, 7) },
    commits: commits.slice(from + 1, stop + 1).map((commit) => ({ sha: commit.sha.slice(0, 7), subject: commit.subject })),
  };
};

// The commit a failing test or a review with changes requested judged in this run, or null.
const stopCommit = (entries, since) => {
  const start = since ? Date.parse(since) : -Infinity;
  const newest = ['test', 'review']
    .map((role) => latestRoleComment(entries.filter((entry) => Date.parse(entry.createdAt) >= start), role))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .pop();
  if (!newest) return null;
  const body = newest.body || '';
  const passed = parseTestSummary(body).status === 'PASS' || reviewVerdict(body) === 'APPROVE';
  return passed ? null : parseTestSummary(body).commit;
};

const formatFiles = (files) => (files.length > 3 ? `${files.slice(0, 3).join(', ')} and ${files.length - 3} more` : files.join(', '));

const formatChanges = ({ since, commits }) => {
  const label = since ? `since the ${since.role} on \`${since.commit}\`` : null;
  if (!commits.length) return `**No commits ${label || 'on the PR'}.**`;
  return [
    label ? `**Commits ${label}:**` : '**Commits, none signed off by a role:**',
    ...commits.map((commit) => `- \`${commit.sha}\` ${commit.subject}${commit.files && commit.files.length ? ` · ${formatFiles(commit.files)}` : ''}${commit.testOnly ? ' (test paths only)' : ''}`),
  ].join('\n');
};

// The summary /unity:ship ends with, the same for the same results.
const formatSummary = ({ number, title, pr, column, next, results, report, changes }) => [
  `**#${number} ${title}**${pr ? ` · PR #${pr.number}` : ''}`,
  results.length ? results.map((result) => `- ${result.line} · ${result.url}`).join('\n') : 'No role posted a result in this run.',
  ...(report ? [`**Test report:** \`${report}\``] : []),
  ...(changes ? [formatChanges(changes)] : []),
  `**Column:** ${column || 'not on the board'}${next ? ` → ${formatNext(next)}` : ''}`,
].join('\n\n');

// ---------- GitHub Projects ----------

const COLUMNS = ['Backlog', 'Design', 'Build', 'Test', 'Review', 'Done'];

// Compares the board's Status options with the expected columns. A column that matches
// only after ignoring case and spacing is "misnamed", so the user can rename it.
const columnReport = (expected, actual) => {
  const normalize = (name) => name.toLowerCase().replace(/\s+/g, '');
  const missing = [];
  const misnamed = [];
  for (const name of expected) {
    if (actual.includes(name)) continue;
    const close = actual.find((option) => normalize(option) === normalize(name));
    if (close !== undefined) misnamed.push({ expected: name, found: close });
    else missing.push(name);
  }
  return { missing, misnamed };
};

// Done is reached on merge only through the board's built-in "Item closed" workflow,
// which new projects ship disabled and the API cannot enable.
const closedWorkflowWarning = (workflows) => {
  const closed = workflows.find((workflow) => workflow.name === 'Item closed');
  if (closed && closed.enabled) return null;
  return 'Warning: the board\'s "Item closed" workflow is off, so merged issues stay in Review. '
    + 'Enable it on the board: ... menu > Workflows > Item closed > set Status to Done > Save and turn on workflow.';
};

const init = (owner, projectNumber) => {
  if (!owner || !projectNumber) die('Usage: pipeline.js init <owner> <project-number>');
  const project = ghJson(['project', 'view', String(projectNumber), '--owner', owner, '--format', 'json']);
  const fields = ghJson(['project', 'field-list', String(projectNumber), '--owner', owner, '--format', 'json']);
  const status = (fields.fields || []).find((field) => field.name === 'Status');
  if (!status || !status.options) die('Project has no single-select "Status" field');
  const existing = readConfig();
  const config = {
    ...existing,
    project: {
      owner,
      number: Number(projectNumber),
      id: project.id,
      statusFieldId: status.id,
      options: Object.fromEntries(status.options.map((option) => [option.name, option.id])),
    },
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const { missing, misnamed } = columnReport(COLUMNS, Object.keys(config.project.options));
  console.log(`Wrote ${configPath}`);
  for (const { expected, found } of misnamed) console.log(`Warning: board column "${found}" must be named exactly "${expected}"`);
  if (missing.length) console.log(`Warning: board is missing columns: ${missing.join(', ')}`);
  const query = 'query($id: ID!) { node(id: $id) { ... on ProjectV2 { workflows(first: 50) { nodes { name enabled } } } } }';
  const workflows = ghJson(['api', 'graphql', '-f', `query=${query}`, '-f', `id=${project.id}`]).data.node.workflows.nodes;
  const warning = closedWorkflowWarning(workflows);
  if (warning) console.log(warning);
};

const issueUrl = (number) => gh(['issue', 'view', String(number), '--json', 'url', '-q', '.url']);

const setStatus = (issueArg, column) => {
  const config = loadConfig();
  const number = resolveIssue(issueArg);
  if (!number || !column) die('Usage: pipeline.js status <issue> <Column>');
  const optionId = config.project.options[column];
  if (!optionId) die(`Unknown column "${column}". Known: ${Object.keys(config.project.options).join(', ')}`);
  // item-add is idempotent: returns the existing item if the issue is already on the board.
  const item = ghJson(['project', 'item-add', String(config.project.number), '--owner', config.project.owner, '--url', issueUrl(number), '--format', 'json']);
  gh(['project', 'item-edit', '--id', item.id, '--project-id', config.project.id, '--field-id', config.project.statusFieldId, '--single-select-option-id', optionId]);
  console.log(`#${number} -> ${column}`);
};

// Issue items of this repo on the board.
const boardIssues = (config) => {
  const repo = currentRepo();
  const data = ghJson(['project', 'item-list', String(config.project.number), '--owner', config.project.owner, '--format', 'json', '--limit', '1000']);
  return (data.items || [])
    .filter((item) => item.content && item.content.type === 'Issue')
    .filter((item) => !item.content.repository || item.content.repository === repo);
};

const queue = (column) => {
  const config = loadConfig();
  if (!column) die('Usage: pipeline.js queue <Column>');
  const items = boardIssues(config)
    .filter((item) => item.status === column)
    .map((item) => ({ number: item.content.number, title: item.content.title, url: item.content.url }));
  console.log(JSON.stringify(items, null, 2));
};

// Whether the issue is on the configured board, and its column there, from the issue's project items.
const boardStatus = (items, projectId) => {
  const item = items.find((i) => i.project && i.project.id === projectId);
  return { onBoard: Boolean(item), status: (item && item.fieldValueByName && item.fieldValueByName.name) || null };
};

const ISSUE_ITEMS_QUERY = 'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issue(number: $number) { '
  + 'projectItems(first: 50) { nodes { project { id } fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }';

// Asks for this one issue's project items instead of listing the whole board.
const issueColumn = (number, config) => {
  const data = ghJson(['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `number=${number}`, '-f', `query=${ISSUE_ITEMS_QUERY}`]);
  return boardStatus(data.data.repository.issue.projectItems.nodes, config.project.id);
};

const check = (issueArg, column) => {
  const config = loadConfig();
  const number = resolveIssue(issueArg);
  if (!number || !column) die('Usage: pipeline.js check <issue> <Column>');
  if (!config.project.options[column]) die(`Unknown column "${column}". Known: ${Object.keys(config.project.options).join(', ')}`);
  const { onBoard, status } = issueColumn(number, config);
  console.log(JSON.stringify({ number, status }));
  if (status !== column) die(`#${number} is ${onBoard ? `in ${status || 'no column'}` : 'not on the board'}, expected ${column}`);
};

// Every issue of this repo on the board, per column in board order, with its PR, latest result
// and next step, plus the warnings. Read-only.
const board = () => {
  const config = loadConfig();
  const items = boardIssues(config);
  const openPrs = ghJson(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,url,headRefName,headRefOid,body,createdAt,isDraft']) || [];
  const mergedPrs = ghJson(['pr', 'list', '--state', 'merged', '--limit', '100', '--json', 'number,url,body']) || [];
  const openIssues = ghJson(['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'number,title']) || [];
  const issues = items.map((item) => {
    const issue = { number: item.content.number, title: item.content.title, url: item.content.url, column: item.status || null };
    if (['Build', 'Test', 'Review'].includes(issue.column)) {
      const found = prForIssue(openPrs, issue.number);
      if (found) {
        issue.pr = { number: found.number, url: found.url, headSha: found.headRefOid, draft: found.isDraft };
        issue.latest = latestResult(roleEntries(issue.number, found));
        if (issue.column === 'Review') issue.coverage = testCoverage(found, latestRoleComment(roleEntries(issue.number, found), 'test'));
      }
    }
    issue.next = nextStep(issue);
    return issue;
  });
  const columns = [...COLUMNS, null]
    .map((name) => ({ name: name || 'No column', issues: issues.filter((issue) => issue.column === name).map(({ column, coverage, ...rest }) => rest) }))
    .filter((column) => column.name !== 'No column' || column.issues.length);
  return { columns, warnings: boardWarnings({ issues, openPrs, mergedPrs, openIssues }) };
};

// One issue's results since the run started, its column and next step. Read-only.
const summary = (issueArg, since) => {
  const config = loadConfig();
  const number = resolveIssue(issueArg);
  if (!number) die('Usage: pipeline.js summary <issue> [--since <ISO time>] [--markdown]');
  if (since && Number.isNaN(Date.parse(since))) die(`--since needs an ISO time, such as 2026-11-03T10:00:00Z; got "${since}"`);
  const { title } = ghJson(['issue', 'view', String(number), '--json', 'title']);
  const found = findPr(number);
  const entries = roleEntries(number, found);
  const pr = found ? { number: found.number, url: found.url, headSha: found.headRefOid } : null;
  const { status: column } = issueColumn(number, config);
  const next = nextStep({ number, column, pr, latest: latestResult(entries) });
  const result = { number, title, pr, column, next, results: runResults(entries, since) };
  const tested = result.results.find((r) => r.report);
  if (tested && fs.existsSync(path.join(root, tested.report))) result.report = path.join(root, tested.report);
  // A run that stopped short of an approval shows what landed since a role last vouched for the code.
  if (found && next !== 'ready to merge') {
    const commits = ghJson(['pr', 'view', String(found.number), '--json', 'commits']).commits
      .map((commit) => ({ sha: commit.oid, subject: commit.messageHeadline }));
    const changes = changesSince({ commits, signOffs: signOffs(entries), stopAt: stopCommit(entries, since) });
    const config = readConfig();
    const testPaths = ((config.test && config.test.writablePaths) || []).filter((p) => !/^artifacts\/?$/.test(p));
    for (const commit of changes.commits) {
      commit.files = (ghJson(['api', `repos/{owner}/{repo}/commits/${commit.sha}`]).files || []).map((file) => file.filename);
      commit.testOnly = Boolean(testPaths.length && commit.files.length && !outsidePaths(commit.files, testPaths).length);
    }
    result.changes = changes;
  }
  return result;
};

const port = (issueArg) => {
  const number = resolveIssue(issueArg);
  if (!number) die('Usage: pipeline.js port <issue>');
  const config = readConfig();
  const base = (config.test && config.test.basePort) || 4000;
  console.log(base + (number % 1000));
};

// ---------- merge ----------

// One merge call must fit in a 10-minute tool call; the skill runs it a second time while CI still runs.
const CI_WAIT_MINUTES = 8;
const CI_POLL_SECONDS = 30;

// The state of a PR's CI from `gh pr checks --json bucket`: a failed or cancelled check fails it,
// one still running keeps it pending, and no checks at all count as passing.
const checksState = (checks) => {
  const buckets = (checks || []).map((check) => check.bucket);
  if (buckets.some((bucket) => bucket === 'fail' || bucket === 'cancel')) return 'fail';
  if (buckets.includes('pending')) return 'pending';
  return 'pass';
};

// Whether autopilot may merge the story, with every reason it may not. Merging needs the story in
// Review, a test pass that covers the PR head, an approval on that head, green CI and a ready PR.
const mergeDecision = ({ number, column, pr, coverage, review, checks, draft }) => {
  if (!pr) return { mergeable: false, reasons: ['no open pull request'] };
  const reasons = [];
  if (column !== 'Review') reasons.push(column ? `#${number} is in ${column}, not Review` : `#${number} is not on the board`);
  if (!coverage || !coverage.covers) reasons.push('the test result does not cover the head commit');
  if (!review || review.status !== 'APPROVE') reasons.push('the review did not approve');
  else if (!onHead(review, pr)) reasons.push('the approval is not on the head commit');
  if (checks === 'fail') reasons.push('a CI check failed');
  if (checks === 'pending') reasons.push(`CI checks still running after ${CI_WAIT_MINUTES} minutes`);
  if (draft) reasons.push('the pull request is a draft');
  return { mergeable: !reasons.length, reasons };
};

// Where a rebase-merged PR landed on main: its commit subjects as one run in main's log
// (newest first), oldest to newest. Null when they aren't all there.
const mergedRange = (prSubjects, mainLog) => {
  if (!prSubjects.length) return null;
  const subjects = [...prSubjects].reverse();
  for (let start = 0; start + subjects.length <= mainLog.length; start += 1) {
    if (subjects.every((subject, offset) => mainLog[start + offset].subject === subject)) {
      return { first: mainLog[start + subjects.length - 1].sha, last: mainLog[start].sha, count: subjects.length };
    }
  }
  return null;
};

// What to do with a merged story's local branch. It is deleted only once every commit's subject is
// on main (a rebase merge changes the SHAs). A checked-out branch is left for main first, unless
// uncommitted changes to tracked files would be in the way.
const branchCleanup = ({ branch, missing, checkedOut, dirty }) => {
  if (missing) return { switchToMain: false, deleteBranch: false, warning: `kept local branch ${branch}: ${missing} commit(s) not on main` };
  if (checkedOut && dirty) return { switchToMain: false, deleteBranch: false, warning: `kept local branch ${branch}: it is checked out with uncommitted changes` };
  return { switchToMain: checkedOut, deleteBranch: true, warning: null };
};

const reviewResult = (entry) => {
  if (!entry) return null;
  const status = reviewVerdict(entry.body);
  const commit = (entry.body.match(/\*\*Commit:\*\*\s+`([0-9a-f]{7,40})`/) || [])[1] || null;
  return { role: 'review', status, commit, url: entry.url };
};

const sleep = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);

// `gh pr checks` exits non-zero on failed checks and when none are configured, so its output is read
// either way. Only "no checks reported" means no checks: any other error is not a pass.
const parseChecksOutput = ({ stdout = '', stderr = '', failed = false }) => {
  try { const checks = JSON.parse(stdout); if (Array.isArray(checks)) return checks; } catch { /* not JSON */ }
  if (!failed && !String(stdout).trim()) return [];
  if (/no checks reported/i.test(stderr)) return [];
  throw new Error(`could not read the CI checks: ${String(stderr || stdout).trim()}`);
};

const prChecks = (prNumber) => {
  // stderr is captured, not shown: gh writes "no checks reported" there on every repository without CI.
  const args = ['pr', 'checks', String(prNumber), '--json', 'bucket'];
  try { return parseChecksOutput({ stdout: execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }); }
  catch (error) {
    if (error.message && error.message.startsWith('could not read the CI checks')) throw error;
    return parseChecksOutput({ stdout: String(error.stdout || ''), stderr: String(error.stderr || error.message), failed: true });
  }
};

// The merge, pinned to the head commit the check approved, so a commit pushed meanwhile is never merged.
const mergeArgs = (prNumber, headSha) => ['pr', 'merge', String(prNumber), '--rebase', '--match-head-commit', headSha];

// Whether the merge went through, from the PR's state afterwards rather than gh's exit code: a queued
// merge exits 0 without merging, and a merge can complete while gh fails on what comes after.
const mergeOutcome = ({ error, state }) => {
  if (state === 'MERGED') return error ? { merged: true, warning: `gh: ${error}` } : { merged: true };
  return error ? { merged: false, reason: `GitHub refused the merge: ${error}` } : { merged: false, reason: 'the merge was queued, not completed' };
};

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// origin/main after a fetch, so the range doesn't depend on the local checkout.
const mainLog = () => { run('git', ['fetch', '--quiet', 'origin', 'main']); return run('git', ['log', '--format=%H%x09%s', '-500', 'origin/main']); };
const mainCommits = () => mainLog()
  .split('\n').filter(Boolean).map((line) => { const [sha, ...rest] = line.split('\t'); return { sha, subject: rest.join('\t') }; });

const merge = (issueArg, { checkOnly = false } = {}) => {
  const config = loadConfig();
  const number = resolveIssue(issueArg);
  if (!number) die('Usage: pipeline.js merge <issue> [--check]');
  const found = findPr(number);
  const pr = found ? { number: found.number, url: found.url, headSha: found.headRefOid } : null;
  const { status: column } = issueColumn(number, config);
  const decide = (checks) => {
    const entries = found ? roleEntries(number, found) : [];
    return mergeDecision({
      number,
      column,
      pr,
      coverage: found ? testCoverage(found, latestRoleComment(entries, 'test')) : null,
      review: reviewResult(latestRoleComment(entries, 'review')),
      checks,
      draft: found ? ghJson(['pr', 'view', String(found.number), '--json', 'isDraft']).isDraft : false,
    });
  };
  let checks = found ? checksState(prChecks(found.number)) : 'pass';
  // Only wait for CI when nothing else stands in the way of the merge.
  if (!checkOnly && checks === 'pending' && decide('pass').mergeable) {
    const deadline = Date.now() + CI_WAIT_MINUTES * 60 * 1000;
    while (checks === 'pending' && Date.now() < deadline) { sleep(CI_POLL_SECONDS); checks = checksState(prChecks(found.number)); }
  }
  const decision = decide(checks);
  const result = { number, pr, ...decision };
  if (checkOnly || !decision.mergeable) return result;

  const branch = found.headRefName;
  const subjects = ghJson(['pr', 'view', String(found.number), '--json', 'commits']).commits.map((commit) => commit.messageHeadline);
  let error;
  try { gh(mergeArgs(found.number, found.headRefOid)); } catch (failure) { error = String(failure.stderr || failure.message).trim(); }
  const outcome = mergeOutcome({ error, state: ghJson(['pr', 'view', String(found.number), '--json', 'state']).state });
  if (!outcome.merged) return { ...result, mergeable: false, merged: false, reasons: [outcome.reason] };
  result.merged = true;
  const warnings = outcome.warning ? [outcome.warning] : [];
  // The remote branch: gone already when the repository deletes merged branches.
  try { run('git', ['push', '--quiet', 'origin', '--delete', branch]); } catch { /* already deleted */ }
  const log = mainCommits();
  result.range = mergedRange(subjects, log);
  // The local branch, and the checkout when it is on that branch.
  const tip = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (tip) {
    const onMain = new Set(log.map((commit) => commit.subject));
    const missing = git(['log', '--format=%s', `origin/main..${branch}`]).split('\n').filter(Boolean).filter((subject) => !onMain.has(subject)).length;
    const checkedOut = currentBranch() === branch;
    const dirty = checkedOut && Boolean(git(['status', '--porcelain', '--untracked-files=no']));
    const cleanup = branchCleanup({ branch, missing, checkedOut, dirty });
    let deleteBranch = cleanup.deleteBranch;
    if (cleanup.warning) warnings.push(cleanup.warning);
    if (cleanup.switchToMain) {
      try { run('git', ['checkout', '--quiet', 'main']); run('git', ['pull', '--quiet', '--ff-only']); result.switchedTo = 'main'; } catch (failure) {
        deleteBranch = currentBranch() !== branch;
        warnings.push(`could not update main after switching from ${branch}: ${String(failure.stderr || failure.message).trim()}`);
      }
    }
    if (deleteBranch) { run('git', ['branch', '-D', branch]); result.deletedBranch = { name: branch, tip }; }
  }
  if (warnings.length) result.warning = warnings.join('; ');
  result.issueClosed = ghJson(['issue', 'view', String(number), '--json', 'state']).state === 'CLOSED';
  return result;
};

// ---------- autopilot: reworks and stopped stories ----------

const STOPPED_LABEL = 'autopilot:stopped';

// The builder's rework comments posted since the run started: this run's reworks only.
const reworksSince = (entries, since) => {
  const start = Date.parse(since);
  return entries.filter((entry) => /<!--\s*role:build(?=\s|-->)/.test(entry.body || '')
    && Boolean(reworkOf(entry.body || ''))
    && Date.parse(entry.createdAt) >= start).length;
};

const maxReworks = (config) => {
  const value = config && config.autopilot && config.autopilot.maxReworks;
  return Number.isInteger(value) && value >= 0 ? value : 2;
};

// What to do with the stories an earlier run stopped at, from their columns. Any of them outside
// Build and Done blocks the run, since later stories may depend on it; one back in Build goes first;
// one in Done only needs its label cleared.
const stoppedPlan = (stopped) => {
  const blocked = stopped.filter((story) => story.column !== 'Build' && story.column !== 'Done');
  if (blocked.length) return { resume: null, clear: [], blocked };
  const resume = stopped.find((story) => story.column === 'Build');
  return { resume: resume ? resume.number : null, clear: stopped.filter((story) => story.column === 'Done').map((story) => story.number), blocked: [] };
};

// Where a stopped story goes: one that stopped in Build moves to Design, so the next run doesn't spend
// another round of reworks on it before the developer has looked. Moving it back to Build is the
// developer's signal to try again. A story that stopped elsewhere stays where it is.
const stopColumn = (column) => (column === 'Build' ? 'Design' : column);

const formatStopComment = ({ number, reason, url, movedTo }) => [
  '<!-- autopilot:stopped -->',
  `**Autopilot stopped at #${number}:** ${reason}`,
  ...(url ? [url] : []),
  movedTo === 'Design'
    ? `Moved to Design. Revise the design with /unity:design ${number}, or move the story back to Build to try it again as it is; the next /unity:autopilot continues from there.`
    : `Move the story back to Build to try again, or finish it with /unity:ship ${number}; the next /unity:autopilot continues from there.`,
].join('\n\n');

const reworks = (issueArg, since) => {
  const number = resolveIssue(issueArg);
  if (!number || !since || Number.isNaN(Date.parse(since))) die('Usage: pipeline.js reworks <issue> --since <ISO time>');
  return { number, reworks: reworksSince(roleEntries(number, findPr(number)), since), max: maxReworks(readConfig()) };
};

const stop = (issueArg, reason, url) => {
  const number = resolveIssue(issueArg);
  if (!number || !reason) die('Usage: pipeline.js stop <issue> --reason <text> [--url <url>]');
  gh(['label', 'create', STOPPED_LABEL, '--color', 'B60205', '--description', 'A story that stopped an autopilot run', '--force']);
  gh(['issue', 'edit', String(number), '--add-label', STOPPED_LABEL]);
  const { status: column } = issueColumn(number, loadConfig());
  const movedTo = stopColumn(column) !== column ? stopColumn(column) : null;
  if (movedTo) setStatus(number, movedTo);
  return gh(['issue', 'comment', String(number), '--body', formatStopComment({ number, reason, url, movedTo })]);
};

// The stories earlier runs stopped at, and what this run does with them. A closed issue counts as Done.
const stoppedStories = (config) => (ghJson(['issue', 'list', '--label', STOPPED_LABEL, '--state', 'all', '--json', 'number,title,state']) || [])
  .map((issue) => ({
    number: issue.number,
    title: issue.title,
    column: issue.state === 'CLOSED' ? 'Done' : issueColumn(issue.number, config).status,
  }));

const resume = () => {
  const plan = stoppedPlan(stoppedStories(loadConfig()));
  for (const number of [...plan.clear, ...(plan.resume ? [plan.resume] : [])]) gh(['issue', 'edit', String(number), '--remove-label', STOPPED_LABEL]);
  return plan;
};

// ---------- autopilot digest ----------

const ROLE_MARKER = /<!--\s*role:(build|test|review)(?=\s|-->)/;

// Every build, test and review result posted since the run started, oldest first: unlike
// runResults, reworks and repeated tests in one run each get their own line.
const allRunResults = (entries, since) => {
  const start = since ? Date.parse(since) : -Infinity;
  return entries
    .map((entry) => ({ entry, role: ((entry.body || '').match(ROLE_MARKER) || [])[1] }))
    .filter(({ entry, role }) => role && Date.parse(entry.createdAt) >= start)
    .sort((a, b) => Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt))
    .map(({ entry, role }) => {
      const result = { role, line: resultLine(role, entry.body || ''), url: entry.url };
      const report = role === 'test' && ((entry.body || '').match(/kept locally in `([^`]+\.html)`/) || [])[1];
      return report ? { ...result, report } : result;
    });
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const formatMerged = ({ number, title, pr, range, issueClosed }) => [
  `- **#${number} ${title}**`,
  ...(pr ? [`PR #${pr.number}`] : []),
  range ? `\`${range.first.slice(0, 7)}..${range.last.slice(0, 7)}\` (${plural(range.count, 'commit')})` : 'commits not found on main',
  ...(issueClosed === false ? ['issue still open'] : []),
].join(' · ');

const digestHeader = ({ merged, stopped, waiting, blocked }) => {
  if (blocked.length) {
    const { number, title, column } = blocked[0];
    return `**Autopilot · nothing started: #${number} ${title} is still stopped${column ? ` in ${column}` : ', not on the board'}**`;
  }
  const parts = [merged.length ? `${merged.length} merged` : 'nothing merged'];
  if (stopped) parts[0] += `, stopped at #${stopped.number}`;
  else if (!merged.length) parts[0] += ', Build is empty';
  if (stopped && waiting.length) parts.push(`${waiting.length} waiting`);
  return `**Autopilot · ${parts.join(' · ')}**`;
};

// The digest /unity:autopilot ends with, the same for the same run.
const formatDigest = ({ merged, stopped, waiting, blocked }) => [
  digestHeader({ merged, stopped, waiting, blocked }),
  ...(merged.length ? [`**Merged**\n${merged.map(formatMerged).join('\n')}`] : []),
  ...(stopped ? [
    [`**Stopped at #${stopped.number} ${stopped.title}**${stopped.pr ? ` · PR #${stopped.pr.number}` : ''}`,
      ...stopped.results.map((result) => `- ${result.line} · ${result.url}`)].join('\n'),
    ...(stopped.report ? [`**Test report:** \`${stopped.report}\``] : []),
    `**Column:** ${stopped.column || 'not on the board'}${stopped.next ? ` → ${formatNext(stopped.next)}` : ''}`,
  ] : []),
  ...(waiting.length ? [`**Still waiting in Build:** ${waiting.map(({ number, title }) => `#${number} ${title}`).join(', ')}`] : []),
].join('\n\n');

// The merged PRs of the run that close an issue, oldest first, each with its issue number.
const mergedSince = (prs, since) => prs
  .filter((p) => Date.parse(p.mergedAt) >= Date.parse(since) && closesIssue(p.body))
  .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt))
  .map((p) => ({ ...p, issue: closesIssue(p.body) }));

const digest = (since, { stoppedArg, withBlocked } = {}) => {
  const config = loadConfig();
  if (!since || Number.isNaN(Date.parse(since))) die('Usage: pipeline.js digest --since <ISO time> [--stopped <issue>] [--blocked] [--markdown]');
  const log = (() => { try { return mainCommits(); } catch { return []; } })();
  // Listed rather than searched: GitHub's search index can lag behind a merge seconds ago.
  // Commits are fetched per merged PR, not listed: gh asks for 100 commits with 100 authors
  // each, so `commits` on a 50-PR list exceeds GitHub's GraphQL limit of 500,000 nodes.
  const prs = ghJson(['pr', 'list', '--state', 'merged', '--limit', '50', '--json', 'number,body,mergedAt']) || [];
  const merged = mergedSince(prs, since)
    .map((p) => {
      const number = p.issue;
      const issue = ghJson(['issue', 'view', String(number), '--json', 'title,state']);
      const subjects = ghJson(['pr', 'view', String(p.number), '--json', 'commits']).commits.map((c) => c.messageHeadline);
      return { number, title: issue.title, pr: { number: p.number }, range: mergedRange(subjects, log), issueClosed: issue.state === 'CLOSED' };
    });
  let stopped = null;
  const stoppedNumber = stoppedArg ? resolveIssue(stoppedArg) : null;
  if (stoppedNumber) {
    const { title } = ghJson(['issue', 'view', String(stoppedNumber), '--json', 'title']);
    const found = findPr(stoppedNumber);
    const entries = roleEntries(stoppedNumber, found);
    const pr = found ? { number: found.number, url: found.url, headSha: found.headRefOid } : null;
    const { status: column } = issueColumn(stoppedNumber, config);
    const results = allRunResults(entries, since);
    const tested = [...results].reverse().find((r) => r.report);
    const report = tested && fs.existsSync(path.join(root, tested.report)) ? path.join(root, tested.report) : null;
    stopped = { number: stoppedNumber, title, pr, results, report, column, next: nextStep({ number: stoppedNumber, column, pr, latest: latestResult(entries) }) };
  }
  const waiting = boardIssues(config)
    .filter((item) => item.status === 'Build' && item.content.number !== stoppedNumber)
    .map((item) => ({ number: item.content.number, title: item.content.title }));
  const blocked = withBlocked ? stoppedPlan(stoppedStories(config)).blocked : [];
  return { merged, stopped, waiting, blocked };
};

// ---------- CLI ----------

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'init') init(args[0], args[1]);
    else if (command === 'resolve') { const n = resolveIssue(args[0]); if (!n) die('No issue found'); console.log(n); }
    else if (command === 'story') console.log(JSON.stringify(story(args[0]), null, 2));
    else if (command === 'design') { const { number, design } = story(args[0]); if (!design) die(`#${number} has no design comment`); process.stdout.write(`${designSpec(design).trimEnd()}\n`); }
    else if (command === 'check-design') console.log(JSON.stringify(checkDesign(args[0], args[1])));
    else if (command === 'comments') console.log(JSON.stringify(comments(args[0], args[1]), null, 2));
    else if (command === 'pr') console.log(JSON.stringify(pr(args[0]), null, 2));
    else if (command === 'tested') console.log(JSON.stringify(tested(args[0]), null, 2));
    else if (command === 'queue') queue(args.join(' '));
    else if (command === 'check') check(args[0], args.slice(1).join(' '));
    else if (command === 'status') setStatus(args[0], args.slice(1).join(' '));
    else if (command === 'port') port(args[0]);
    else if (command === 'summary') {
      const sinceAt = args.indexOf('--since');
      const result = summary(args[0], sinceAt === -1 ? undefined : args[sinceAt + 1]);
      console.log(args.includes('--markdown') ? formatSummary(result) : JSON.stringify(result, null, 2));
    }
    else if (command === 'pointer') {
      const line = pointer(args[0], args[1]);
      console.log(args.includes('--post') ? gh(['issue', 'comment', String(resolveIssue(args[0])), '--body', line]) : line);
    }
    else if (command === 'merge') {
      const result = merge(args[0], { checkOnly: args.includes('--check') });
      console.log(JSON.stringify(result, null, 2));
      if (!result.mergeable) process.exit(1);
    }
    else if (command === 'reworks') { const at = args.indexOf('--since'); console.log(JSON.stringify(reworks(args[0], at === -1 ? undefined : args[at + 1]))); }
    else if (command === 'stop') {
      const reasonAt = args.indexOf('--reason');
      const urlAt = args.indexOf('--url');
      console.log(stop(args[0], reasonAt === -1 ? undefined : args[reasonAt + 1], urlAt === -1 ? undefined : args[urlAt + 1]));
    }
    else if (command === 'resume') console.log(JSON.stringify(resume(), null, 2));
    else if (command === 'digest') {
      const at = (flag) => (args.indexOf(flag) === -1 ? undefined : args[args.indexOf(flag) + 1]);
      const result = digest(at('--since'), { stoppedArg: at('--stopped'), withBlocked: args.includes('--blocked') });
      console.log(args.includes('--markdown') ? formatDigest(result) : JSON.stringify(result, null, 2));
    }
    else if (command === 'board') console.log(args.includes('--markdown') ? formatBoard(board()) : JSON.stringify(board(), null, 2));
    else die('Commands: init | resolve | story | design | check-design | comments | pr | tested | queue | check | status | port | board | pointer | summary | merge | reworks | stop | resume | digest');
  } catch (error) {
    die(error.stderr ? String(error.stderr) : error.message);
  }
}

module.exports = { designSpec, reviewVerdict, reworkOf, parseCriteria, resolveIssue, latestRoleComment, columnReport, parseTestSummary, outsidePaths, closedWorkflowWarning, prForIssue, boardStatus, designVersion, closesIssue, latestResult, nextStep, boardWarnings, formatBoard, formatPointer, runResults, formatSummary, compareComment, changesSince, signOffs, checksState, mergeDecision, mergedRange, reworksSince, maxReworks, stoppedPlan, stopColumn, formatStopComment, allRunResults, formatDigest, parseChecksOutput, mergeArgs, mergeOutcome, mergedSince, branchCleanup };
