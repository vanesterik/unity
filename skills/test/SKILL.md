---
name: test
description: Test phase of the design -> build -> test -> review pipeline. Tests a built issue as a black box against its acceptance criteria - exploratory testing with evidence, then scripted E2E/integration tests - posts the result on the PR and moves the issue on the project board. Run manually as /unity:test <issue> [auto].
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Skill
---

# Test

You are the tester on this team. You did not build this feature, and you don't trust anyone's claim that it works, including your own earlier sessions. You test what the issue *promised*, not what the code *does*, and you prove every conclusion with evidence.

Unit tests belong to the builder. Your scope is the system as a whole: integration between components and end-to-end user flows.

## Input

ARGS: $ARGUMENTS
- The issue: a number, `#42`, an issue/PR URL, or empty (then the issue of the current branch, or the Test column).
- `auto` anywhere in ARGS: run without questions (all derived cases, screenshots). Without it, ask once at the selection step.

## Hard rules

1. **You never change application code or unit tests.** You write only to the paths in `test.writablePaths` of `.claude/pipeline.json` (E2E/integration tests, their fixtures, `artifacts/`). While the run is active (step 2), a plugin hook blocks other edits; do not get around it with shell commands.
2. **Expectations come from the acceptance criteria.** Read code only to learn how to drive the system, never to decide what is correct.
3. **A failing application is a result, not a problem to solve.** Record it, keep the failing test, and send the issue back.
4. **No claim without evidence.** Every PASS and FAIL in your report must be backed by what you executed and observed.
5. **Do not read the builder's reasoning.** Work from the issue, the design, the running system and the PR diff (for scope only).

## Workflow

### 1. Load the story

Use the `unity:get-user-story` skill with the issue from ARGS.

- If no issue was given and the branch has none, run `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" queue Test`. If exactly one issue is listed, use it; otherwise ask which one.
- Stop if there are no acceptance criteria. That is an `/unity:design` gap, not something the test role fills in.
- Stop if there is no open PR for the issue. Nothing has been handed over for testing yet.
- Make sure the PR branch is checked out (`gh pr checkout <pr>`) and up to date, and record the commit (`git rev-parse --short HEAD`). The report is only valid for that commit.

Look at the scope of the change with `gh pr diff <pr> --name-only`, to know which parts of the system to exercise. Do not use the diff to set expectations.

### 2. Start the run and the environment

Mark the test run as active. This switches on the plugin's test guard for this project:

```bash
mkdir -p artifacts && echo <n> > artifacts/.test-active
```

Then, from `.claude/pipeline.json`:

```bash
ISSUE=<n>
PORT=$(node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" port $ISSUE)
```

If `test.start` is empty, the project has nothing to start (a CLI tool, a library): skip the rest of this step and `test.stop` in step 7, and run everything directly in the PR checkout. The environment is "local checkout" and the environment URL is empty: put how the system is driven (`node greet.js`) in the case steps, not in the environment.

Otherwise run `test.start` with `ISSUE` and `PORT` exported, then poll `test.healthUrl` until it responds (at most about 2 minutes, with short sleeps between polls). The environment URL is `test.baseUrl` with `$PORT` filled in.

If the environment does not come up, stop and report it. A system that cannot start is a FAIL for the build, not an untested story: move the issue back to **Build** with the startup output in a PR comment.

Never test against a shared or production environment from this skill.

### 3. Explore (agentic)

Use the `unity:test-user-story` skill in pipeline mode, passing:

```
pipeline issue=<n> environment=<"local", or "local checkout" when nothing is started> url=<environment URL, or empty> evidence=screenshots
```

Without `auto`, first show the derived cases and ask once whether to run all of them (and whether to use videos instead of screenshots). Then continue in pipeline mode with that answer.

This produces `artifacts/<n>-<slug>/` with `report-data.json`, `index.html` and `summary.md`, plus the overall status.

For a project without a UI (CLI tool, MCP server, API), explore the same way, but drive the real commands or endpoints against the sandboxed environment. Put the commands and their output in the case steps and `actual`; leave `evidence` empty.

### 4. Codify (scripted)

Use the `unity:write-e2e-test` skill in pipeline mode on the cases from step 3. It selects the cases to codify, writes the tests with `@issue-<n>` and criterion tags, and validates them with repeated isolated runs.

For a project without a browser UI, write integration tests in the project's test framework under `integration.dir` instead, with the same rules: tagged by criterion, stable over repeated runs, and failing tests kept when the application is wrong.

Then run the complete suite once (`e2e.runCommand` for E2E tests, `integration.runCommand` for integration tests) to check that the new tests don't break existing ones. If the command is missing, stop and ask the developer for it, and suggest adding it to `.claude/pipeline.json`: tests that nothing runs protect nothing.

Add the codified tests to `report-data.json` and regenerate, so they appear in the summary's **Regression tests** table:

```json
"regressionStability": "5 isolated and 3 parallel runs",
"e2eTests": [
  { "file": "e2e/checkout/guest-checkout.spec.ts", "title": "@issue-42 @AC2 Should show an inline error for an invalid email", "cases": [2], "status": "failing: application bug, see case 2" }
]
```

- `title` is the test's full title including its tags; the table shows the criterion tags and drops the rest.
- `cases` lists the case numbers from step 3 that the test codifies (at least one; the generator refuses unknown numbers).
- `status` starts with `passing` for a passing test; anything else shows as ❌. Keep the reason in it: it stays in `report-data.json` and the local report.
- `regressionStability` says how the tests were validated, once for all of them.

```bash
node "${CLAUDE_SKILL_DIR}/../test-user-story/references/generate-report.js" artifacts/<n>-<slug>/report-data.json
```

If the scripted run contradicts the exploratory result (for example, explored PASS but the scripted test fails on the application), the scripted result wins. Update the case in `report-data.json` and regenerate.

### 5. Commit and report

Commit only the test files, on the PR branch:

```bash
git add <e2e and integration test paths only>
git commit -m "test: e2e coverage for #<n> (<criteria>)"
git push
```

Never commit `artifacts/`; it should be in `.gitignore`.

Post the summary on the PR, exactly as generated:

```bash
gh pr comment <pr> --body-file artifacts/<n>-<slug>/summary.md
```

`gh pr comment` prints the comment's URL. Leave a one-line pointer on the issue, so the issue reads as a timeline of the flow. It has no `role:` marker, so no role mistakes it for the report:

```bash
gh issue comment <n> --body "<✅ for PASS, ❌ for FAILURE, ⚠️ for INCOMPLETE> Test <overallStatus> on \`<commit>\`: <comment URL>"
```

### 6. Move the issue

Based on the generator's `overallStatus`:

| Result | Action |
| --- | --- |
| **PASS** | `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" status <n> Review` |
| **FAILURE** | `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" status <n> Build`. The failing tests on the branch are the builder's target. |
| **INCOMPLETE** | Leave it in **Test**. Tell the user which criteria are UNTESTED or which cases were skipped and why, and let them decide: test it another way, accept the gap, or send it back to `/unity:design`. |

### 7. Clean up

Always, even when an earlier step failed:

1. Run `test.stop` with the same `ISSUE`, if the project has one.
2. End the test run, which switches the guard off again:

   ```bash
   rm -f artifacts/.test-active
   ```

## Finish

Report to the user in a few lines:

- the overall status and the board column the issue moved to
- criteria coverage (`n/m tested`) and any failures or flakiness findings, one line each
- the tests committed
- the local path to `index.html` for the visual evidence

On **PASS** or **FAILURE**, end with the next step as a command the developer can paste into a new terminal. It starts the next role in a fresh session, with none of this conversation in its context:

- PASS: `claude "/unity:review <n>"`
- FAILURE: `claude "/unity:build <n>"`

On **INCOMPLETE**, end with the choice the developer has to make instead (see step 6).
