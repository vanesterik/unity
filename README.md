# unity

A Claude Code plugin for a role-based development flow on GitHub: **architect -> build -> qa -> review**. Each role runs in a fresh context, and GitHub issues, PRs and a Project board are the only handoff between roles.

This version ships the **QA role** and the shared plumbing. `architect`, `build` and `review` follow the same conventions and are planned next.

## Install

The repository is its own marketplace.

**Per project (recommended).** Run `/unity:init` once; it adds this to the project's `.claude/settings.json`, so the flow is enabled for that repo:

```json
{
  "extraKnownMarketplaces": {
    "unity": { "source": { "source": "github", "repo": "vanesterik/unity" }, "autoUpdate": true }
  },
  "enabledPlugins": { "unity@unity": true }
}
```

**First time on a machine**, install it at user level so `/unity:init` is available before a project is set up:

```
/plugin marketplace add vanesterik/unity
/plugin install unity@unity
```

Then, in each project:

```
/unity:init <owner> <project-number>
```

Prerequisites: `gh` with project access (`gh auth refresh -s project`), Node, and for web projects Playwright, `eslint-plugin-playwright` and the `playwright-cli` skill.

## Commands

| Command | What it does |
| --- | --- |
| `/unity:init <owner> <project>` | Sets up a repo: config, `CLAUDE.md` section, `.gitignore`, plugin settings, board IDs, detected start/test commands |
| `/unity:qa <issue> [auto]` | QA phase: explore against acceptance criteria, write scripted tests, post the result on the PR, move the issue on the board |
| `/unity:test-user-story <issue or story>` | Exploratory browser testing with an evidence report; also usable on its own |
| `/unity:write-e2e-test` | Write and stabilize Playwright tests; also usable on its own |
| `/unity:get-user-story <issue>` | Issue + latest design + acceptance criteria, as used by the skills above |

## Board

The GitHub Project's **Status** field is the workflow state. The columns must be named exactly:

`Backlog` · `Design` · `Ready to Build` · `Building` · `QA` · `Review` · `Done`

Only you move an issue from Design to Ready to Build. QA moves it to Review on a pass, or back to Building on a failure.

## Layout

```
.claude-plugin/
  plugin.json            plugin manifest (name, version)
  marketplace.json       this repo as a one-plugin marketplace
skills/
  init/                  project setup
  qa/                    QA role
  get-user-story/        issue -> story with acceptance criteria
  test-user-story/       exploratory testing + report generator (references/)
  write-e2e-test/        scripted Playwright tests
hooks/
  hooks.json             registers the two hooks below
  qa-guard.js            during a QA run, blocks edits outside the test paths
  lint-e2e.js            lints E2E files after every edit; lint errors block
scripts/
  pipeline.js            issue resolution, criteria parsing, board moves, ports
  init-project.js        idempotent per-project file setup used by init
templates/               pipeline.json, CLAUDE.md workflow section, environments.json
```

What lives where:

- **In this plugin (shared):** skills, hooks, scripts, report template.
- **In each project:** `.claude/pipeline.json` (board IDs, start/stop and test commands), the workflow section of `CLAUDE.md`, `environments.json`, and `ai-evidence/` in `.gitignore`.

Skills locate plugin files through `${CLAUDE_SKILL_DIR}`, and hooks through `${CLAUDE_PLUGIN_ROOT}`. Project files are found through `CLAUDE_PROJECT_DIR` or the git root, so the same plugin works in every repo and worktree.

## How the QA guard works

`/unity:qa` writes `ai-evidence/.qa-active` when a run starts and removes it at the end. While that file exists, `qa-guard.js` blocks Edit/Write outside `qa.writablePaths`. Outside a QA run the guard does nothing. If a run is interrupted and edits stay blocked, delete `ai-evidence/.qa-active`.

## Updating

Bump `version` in `.claude-plugin/plugin.json` with each change. Projects with `autoUpdate: true` pick up new versions automatically; otherwise run `/plugin marketplace update unity`.

## Credits

`test-user-story`, `write-e2e-test`, the report template and the generator are adapted from Tim Lolkema's skills ([tlolkema/demo-webshop](https://github.com/tlolkema/demo-webshop), described in [Using agent skills to write Playwright tests](https://tlolkema.substack.com/p/using-agent-skills-to-write-playwright) and [Why you should start using agentic testing](https://tlolkema.substack.com/p/why-you-should-start-using-agentic)).
