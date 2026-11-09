---
name: init
description: Set up the unity workflow in the current repository - per-project config, CLAUDE.md workflow section, .gitignore, plugin settings, and the GitHub Project board IDs. Run once per project as /unity:init <owner> <project-number>.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

# Init unity

Prepare this repository for the design -> build -> review flow. The plugin holds the shared skills; this skill creates the per-project parts and fills them in from what the repository already contains.

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
| `CLAUDE.md` | workflow section appended (between `unity:workflow` markers) if not there yet |
| `.gitignore` | `artifacts/` added |
| `.claude/settings.json` | marketplace registered and plugin enabled for this repo, merged with existing settings |

### 3. Read the board

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" init <owner> <project-number>
```

This writes the project, Status field and column IDs into `.claude/pipeline.json`. If it warns about missing or misnamed columns, tell the user exactly which ones to add or rename in the board's **Status** field (Backlog, Design, Build, Review, Done), then run this step again. A Test column left from an older unity is fine: nothing uses it, and the user may delete it. If it warns that the "Item closed" workflow is off, pass on its steps: without that workflow a merged issue never reaches **Done**. GitHub's API cannot switch it on, so the user does this once on the board. Do not continue until all columns exist.

### 4. Fill in the project specifics

First, the kinds of tests `/unity:test` writes: **integration**, **E2E**, or **both**. Propose one from what you find:

- a Playwright config, or an `e2e/` or `tests/e2e/` directory, points to E2E
- an integration test directory, or a project without a browser UI (a CLI, a library, an MCP server), points to integration
- both kinds present points to both

Then inspect the repository and propose values for the `test` block of `.claude/pipeline.json`, the block of each chosen kind (`integration`, `e2e`), and the CLAUDE.md section of each chosen kind (**Integration testing**, **E2E testing**). Look at:

- **Package manager**: lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `uv.lock`, `poetry.lock`).
- **How the app starts**: `docker-compose*.yml` / `compose*.yml`, `package.json` scripts (`dev`, `start`, `preview`), `Makefile`. The start command must take its port from `$PORT` and must not collide between issues; use `$ISSUE` for container project names.
- **Health check**: an existing `/health` or similar route; otherwise the base URL itself.
- **E2E setup**: `playwright.config.*`, an existing `e2e/` or `tests/e2e/` directory, fixtures.
- **Integration tests**: their directory, framework and the command that runs them all, and how they start or call the system.
- **i18n**: a messages or translations file, and the helper the code uses for it.
- **UI components** and the **API layer** (GraphQL schema/resolvers or REST routes).

For a project with nothing to start (a CLI tool or a library), set `test.start`, `test.stop`, `test.healthUrl` and `test.baseUrl` to empty strings: `/unity:test` then runs everything in the checkout. `integration.runCommand` runs every integration test and must not be part of the unit test command.

For a project with a browser UI, also create `environments.json` from the plugin's template if it is missing (`cp "${CLAUDE_SKILL_DIR}/../../templates/environments.json" environments.json`) and propose its URLs. `test-user-story` offers these environments when it runs on its own; `/unity:test` doesn't need them.

Present the proposed kinds and values in one short list and ask the user to confirm or correct them, in a single question round. Mark anything you could not find as missing instead of guessing. Then record the kinds; this keeps only the chosen blocks in `.claude/pipeline.json` and sets `test.writablePaths` to their directories plus `artifacts/`:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" test-kinds <integration|e2e|both>
```

Write the confirmed values into the chosen blocks, and into `CLAUDE.md`, inside the `unity:workflow` markers only:

- Keep the section of each chosen kind (**Integration testing**, **E2E testing**) and fill it in. Remove the section of a kind that wasn't chosen, so no role reads a section for tests the project doesn't write.
- On a re-run, the existing section may carry another heading or a note pointing to the old one; give it the chosen kind's heading and drop such a note.

### 5. Check the tooling

Report, without installing anything:

- whether Playwright is installed and has a config (E2E)
- whether the `playwright-cli` skill is available (`test-user-story` drives the browser through it)
- whether `integration.runCommand` runs (integration)
- whether the start command brings the app up: only if the user agrees, run `test.start` and the health check once with a test `ISSUE=0`, then `test.stop`

### 6. Finish

Summarize in a few lines: the files created or changed, the board connection, anything still missing, and the commit to make:

```bash
git add .claude/pipeline.json .claude/settings.json CLAUDE.md .gitignore   # plus environments.json if it was created
git commit -m "chore: set up unity workflow"
```

Commit only if the user asks. End with the next step: write an issue, add it to the board's **Backlog**, and run `/unity:design <n>` to start the flow.
