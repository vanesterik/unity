#!/usr/bin/env node
// Pipeline helper for the architect -> build -> qa -> review flow.
// All GitHub access goes through the gh CLI (needs: gh auth refresh -s project).
// Lives in the unity plugin; per-project settings are read from <project>/.claude/pipeline.json.
// Skills call it as: node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" <command>
//
//   pipeline.js init <owner> <project-number>   discover project/field/option IDs into .claude/pipeline.json
//   pipeline.js resolve [arg]                   print the issue number (arg, #n, URL, or current branch)
//   pipeline.js story [arg]                     issue + latest architect design + acceptance criteria as JSON
//   pipeline.js queue <Column>                  issues of this repo in a board column, as JSON
//   pipeline.js status <issue> <Column>         move the issue's project item to a column
//   pipeline.js port <issue>                    deterministic local port for this issue's worktree
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
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const ghJson = (args) => JSON.parse(gh(args) || 'null');
const git = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const currentBranch = () => git(['branch', '--show-current']) || git(['rev-parse', '--abbrev-ref', 'HEAD']);

const loadConfig = () => {
  if (!fs.existsSync(configPath)) die(`Missing ${configPath}. Run /unity:init <owner> <project-number> in this project.`);
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
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

const ARCHITECT_MARKER = '<!-- role:architect';

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
  const designs = (issue.comments || []).filter((comment) => (comment.body || '').includes(ARCHITECT_MARKER));
  const design = designs.length ? designs[designs.length - 1] : null;
  let criteria = design ? parseCriteria(design.body) : [];
  let criteriaSource = design ? 'architect-comment' : null;
  if (!criteria.length) {
    criteria = parseCriteria(issue.body);
    criteriaSource = criteria.length ? 'issue-body' : null;
  }
  const branch = currentBranch();
  let pr = null;
  try {
    const prs = ghJson(['pr', 'list', '--search', `${number} in:body`, '--state', 'open', '--json', 'number,url,headRefName,body']);
    pr = (prs || []).find((p) => new RegExp(`(closes|fixes|resolves)\\s+#${number}\\b`, 'i').test(p.body || '')) || null;
    if (pr) delete pr.body;
  } catch { /* no PR yet */ }
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    body: issue.body,
    design: design ? design.body : null,
    designVersion: design ? ((design.body.match(/role:architect\s+(v\d+)/) || [])[1] || 'v1') : null,
    criteria,
    criteriaSource,
    branch,
    commit: git(['rev-parse', '--short', 'HEAD']),
    pr,
  };
};

// ---------- GitHub Projects ----------

const init = (owner, projectNumber) => {
  if (!owner || !projectNumber) die('Usage: pipeline.js init <owner> <project-number>');
  const project = ghJson(['project', 'view', String(projectNumber), '--owner', owner, '--format', 'json']);
  const fields = ghJson(['project', 'field-list', String(projectNumber), '--owner', owner, '--format', 'json']);
  const status = (fields.fields || []).find((field) => field.name === 'Status');
  if (!status || !status.options) die('Project has no single-select "Status" field');
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
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
  const expected = ['Backlog', 'Design', 'Ready to Build', 'Building', 'QA', 'Review', 'Done'];
  const missing = expected.filter((name) => !config.project.options[name]);
  console.log(`Wrote ${configPath}`);
  if (missing.length) console.log(`Warning: board is missing columns: ${missing.join(', ')}`);
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

const queue = (column) => {
  const config = loadConfig();
  if (!column) die('Usage: pipeline.js queue <Column>');
  const repo = currentRepo();
  const data = ghJson(['project', 'item-list', String(config.project.number), '--owner', config.project.owner, '--format', 'json', '--limit', '1000']);
  const items = (data.items || [])
    .filter((item) => item.status === column && item.content && item.content.type === 'Issue')
    .filter((item) => !item.content.repository || item.content.repository === repo)
    .map((item) => ({ number: item.content.number, title: item.content.title, url: item.content.url }));
  console.log(JSON.stringify(items, null, 2));
};

const port = (issueArg) => {
  const number = resolveIssue(issueArg);
  if (!number) die('Usage: pipeline.js port <issue>');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const base = (config.qa && config.qa.basePort) || 4000;
  console.log(base + (number % 1000));
};

// ---------- CLI ----------

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'init') init(args[0], args[1]);
    else if (command === 'resolve') { const n = resolveIssue(args[0]); if (!n) die('No issue found'); console.log(n); }
    else if (command === 'story') console.log(JSON.stringify(story(args[0]), null, 2));
    else if (command === 'queue') queue(args.join(' '));
    else if (command === 'status') setStatus(args[0], args.slice(1).join(' '));
    else if (command === 'port') port(args[0]);
    else die('Commands: init | resolve | story | queue | status | port');
  } catch (error) {
    die(error.stderr ? String(error.stderr) : error.message);
  }
}

module.exports = { parseCriteria, resolveIssue };
