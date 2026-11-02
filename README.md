# unity

A Claude Code plugin for a role-based development flow on GitHub: **design -> build -> test -> review**. Each role runs in a fresh context, and GitHub issues, PRs and a Project board are the only handoff between roles.

It ships all four roles (**design**, **build**, **test** and **review**) and the shared plumbing.

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

Prerequisites:

- [Superpowers](https://github.com/obra/superpowers), which the role skills build on for brainstorming, plans, TDD, verification and code review: `/plugin install superpowers@claude-plugins-official`
- `gh` with project access (`gh auth refresh -s project`)
- Node
- for web projects: Playwright and the `playwright-cli` skill

## Commands

| Command | What it does |
| --- | --- |
| `/unity:init <owner> <project>` | Sets up a repo: config, `CLAUDE.md` section, `.gitignore`, plugin settings, board IDs, detected start/test commands |
| `/unity:design <issue>` | Design phase: pick up an issue, work out the design with you, post design + acceptance criteria + plan as one issue comment, move it to Build on your approval |
| `/unity:build <issue>` | Build phase: implement the approved plan task by task with test-first unit tests, open a PR that maps each criterion to code and tests, move it to Test; also handles rework |
| `/unity:test <issue> [auto]` | Test phase: explore against acceptance criteria, write scripted tests, post the result on the PR, move the issue on the board |
| `/unity:review <issue or PR>` | Review phase: independent code review of the whole PR against the design and criteria; posts a verdict with blocking findings and suggestions, sends the issue back to Build or leaves it ready to merge |
| `/unity:test-user-story <issue or story>` | Exploratory browser testing with an evidence report; also usable on its own |
| `/unity:write-e2e-test` | Write and stabilize Playwright tests; also usable on its own |
| `/unity:get-user-story <issue>` | Issue + latest design + acceptance criteria, as used by the skills above |

## Board

The GitHub Project's **Status** field is the workflow state. The columns must be named exactly:

`Backlog` · `Design` · `Build` · `Test` · `Review` · `Done`

Each role is named after the column it works in. Picking an issue with `/unity:design` sets the flow in motion: design moves it to Build once you approve the design in conversation, build to Test when the PR is open, test to Review on a pass (or back to Build on a failure), review back to Build on blocking findings or leaves it for you to merge, and merging moves it to Done through the board's "Item closed" workflow. New boards ship with that workflow off and the API can't enable it; `/unity:init` warns until you switch it on (board ... menu > Workflows > Item closed, Status: Done).

Designs and plans live in the issue as the `role:design` comment, not as files in the repository.

## Layout

```
.claude-plugin/
  plugin.json            plugin manifest (name, version)
  marketplace.json       this repo as a one-plugin marketplace
skills/
  init/                  project setup
  design/                design role
  build/                 build role
  test/                  test role
  review/                review role + review comment generator (references/)
  get-user-story/        issue -> story with acceptance criteria
  test-user-story/       exploratory testing + report generator (references/)
  write-e2e-test/        scripted Playwright tests
hooks/
  hooks.json             registers the hook below
  edit-guard.js          during a test run, blocks edits outside the test paths
scripts/
  pipeline.js            issue resolution, criteria parsing, role comments, PR lookup, test coverage of the PR head, board checks and moves, ports
  init-project.js        idempotent per-project file setup used by init
templates/               pipeline.json, CLAUDE.md workflow section, environments.json
tests/                   unit tests for pipeline.js and the two report generators
```

What lives where:

- **In this plugin (shared):** skills, hooks, scripts, report template.
- **In each project:** `.claude/pipeline.json` (board IDs, start/stop and test commands), the workflow section of `CLAUDE.md`, `artifacts/` in `.gitignore`, and for web projects `environments.json`.

Skills locate plugin files through `${CLAUDE_SKILL_DIR}`, and hooks through `${CLAUDE_PLUGIN_ROOT}`. Project files are found through `CLAUDE_PROJECT_DIR` or the git root, so the same plugin works in every repo and worktree.

## How the test guard works

`/unity:test` writes `artifacts/.test-active` when a run starts and removes it at the end. While that file exists, `edit-guard.js` blocks Edit/Write outside `test.writablePaths`. Outside a test run the guard does nothing. If a run is interrupted and edits stay blocked, delete `artifacts/.test-active`.

## Updating

Run the tests with `npm test`.

Bump `version` in `.claude-plugin/plugin.json` with each change. Projects with `autoUpdate: true` pick up new versions automatically; otherwise run `/plugin marketplace update unity`.

## Credits

`test-user-story`, `write-e2e-test`, the report template and the generator are adapted from Tim Lolkema's skills ([tlolkema/demo-webshop](https://github.com/tlolkema/demo-webshop), described in [Using agent skills to write Playwright tests](https://tlolkema.substack.com/p/using-agent-skills-to-write-playwright) and [Why you should start using agentic testing](https://tlolkema.substack.com/p/why-you-should-start-using-agentic)).
