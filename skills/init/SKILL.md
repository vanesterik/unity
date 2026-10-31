---
name: init
description: Set up the unity workflow in the current repository - per-project config, CLAUDE.md workflow section, .gitignore, plugin settings, and the GitHub Project board IDs. Run once per project as /unity:init <owner> <project-number>.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# Init unity

Prepare this repository for the architect -> build -> qa -> review flow. The plugin holds the shared skills; this skill creates the per-project parts and fills them in from what the repository already contains.

## Input

ARGS: $ARGUMENTS, expected as `<owner> <project-number>` for the GitHub Project that holds this repo's issues (e.g. `vanesterik 3`).

## Steps

### 1. Preconditions

Check these and stop with a clear instruction if one fails:

- The current directory is inside a git repository with a GitHub remote: `gh repo view --json nameWithOwner -q .nameWithOwner`.
- `gh` is logged in with the `project` scope: `gh auth status` lists `project` among the token scopes. If not, tell the user to run `gh auth refresh -s project`.
- `node` is available.

If ARGS has no owner or project number, run `gh project list --owner <repo owner>` and ask which project to use.

### 2. Put the per-project files in place

Run the setup script. It never overwrites existing files; it only adds what's missing:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/init-project.js"
```

It creates or updates:

| File | What happens |
| --- | --- |
| `.claude/pipeline.json` | created from the template if missing |
| `environments.json` | created from the template if missing |
| `CLAUDE.md` | workflow section appended (between `unity:workflow` markers) if not there yet |
| `.gitignore` | `ai-evidence/` added |
| `.claude/settings.json` | marketplace registered and plugin enabled for this repo, merged with existing settings |

### 3. Read the board

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" init <owner> <project-number>
```

This writes the project, Status field and column IDs into `.claude/pipeline.json`. If it warns about missing columns, tell the user exactly which ones to add to the board's **Status** field (Backlog, Design, Ready to Build, Building, QA, Review, Done), then run this step again. Do not continue to QA use until all columns exist.

### 4. Fill in the project specifics

Inspect the repository and propose values for the `qa` and `e2e` blocks of `.claude/pipeline.json` and the **E2E testing** section of `CLAUDE.md`. Look at:

- **Package manager**: lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `uv.lock`, `poetry.lock`).
- **How the app starts**: `docker-compose*.yml` / `compose*.yml`, `package.json` scripts (`dev`, `start`, `preview`), `Makefile`. The start command must take its port from `$PORT` and must not collide between issues; use `$ISSUE` for container project names.
- **Health check**: an existing `/health` or similar route; otherwise the base URL itself.
- **E2E setup**: `playwright.config.*`, an existing `e2e/` or `tests/e2e/` directory, fixtures, an ESLint config with `eslint-plugin-playwright`.
- **Integration tests**: their directory and framework (for projects without a UI, such as a CLI or MCP server, these carry QA).
- **i18n**: a messages or translations file, and the helper the code uses for it.
- **UI components** and the **API layer** (GraphQL schema/resolvers or REST routes).

Also set `qa.writablePaths` to the E2E directory, the integration test directory and `ai-evidence/`.

Present the proposed values in one short list and ask the user to confirm or correct them, in a single question round. Mark anything you could not find as missing instead of guessing. Then write the confirmed values into `.claude/pipeline.json` and the **E2E testing** section of `CLAUDE.md`. Edit only inside the `unity:workflow` markers.

### 5. Check the tooling

Report, without installing anything:

- whether Playwright is installed and has a config (web projects)
- whether the `playwright-cli` skill is available (`test-user-story` drives the browser through it)
- whether `eslint-plugin-playwright` is configured, and whether `e2e.lintCommand` runs successfully
- whether the start command brings the app up: only if the user agrees, run `qa.start` and the health check once with a test `ISSUE=0`, then `qa.stop`

### 6. Finish

Summarize in a few lines: the files created or changed, the board connection, anything still missing, and the commit to make:

```bash
git add .claude/pipeline.json .claude/settings.json CLAUDE.md environments.json .gitignore
git commit -m "chore: set up unity workflow"
```

Commit only if the user asks. End with the next step: write an issue, add the design and numbered acceptance criteria in the format from the `CLAUDE.md` workflow section (with `/unity:architect` once the plugin includes it, otherwise by hand), and move it to **Ready to Build**.
