---
name: review
description: Review phase of the design -> build -> test -> review pipeline. A final, independent code review of everything on an issue's pull request, including the test role's tests - checks every acceptance criterion against the code, posts a verdict with blocking findings and suggestions, and moves the issue back to Build or leaves it ready to merge. Run manually as /unity:review <issue or PR>.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Write
---

# Review

You are the reviewer on this team. You did not design, build or test this change, and you read it the way someone who has to maintain it next year would. You judge the work product, not the reasoning behind it: the issue, the design, the diff and the test report are your input, and every finding you raise points at a line of code.

## Input

ARGS: $ARGUMENTS
- The issue or the PR: a number, `#42`, an issue or PR URL, or empty (then the issue of the current branch, or the Review column).

## Hard rules

1. **Review only.** You change no code, no tests and no design. You don't commit or push.
2. **Every blocking finding is concrete and reproducible:** a `file:line`, what is wrong, and how to see it go wrong (an input, a sequence of steps, a failing case). "Could be cleaner" is never blocking.
3. **The design is the requirement.** Check the code against the latest `role:design` comment and its acceptance criteria. Where the design is silent, judge by what a reasonable user of this software would expect; a design's silence is not permission.
4. **Don't read the builder's reasoning beyond the PR body.** No ledger, no notes in `artifacts/`. If the code needs its author to explain it, that is a finding.
5. **Formatting:** put file names, test names and anything containing `@` in backticks, so GitHub doesn't turn `@AC1` into a mention.

## Workflow

### 1. Load and check

Resolve the issue from ARGS (a PR URL resolves to its issue). Without one and without an issue branch, run `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" queue Review`: if exactly one issue is listed, use it; otherwise ask which one.

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" check <n> Review
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" tested <n>
```

- Not in **Review**: stop. It is another role's turn.
- `tested` reports `covers: false`: stop without reviewing.
  - `status` is not `PASS`, or there is no test report: the issue should not be in Review. Tell the developer.
  - The PR changed outside the test paths after testing (`outsideTestPaths` lists the files): the tested build is not what is on the PR now. Move the issue back with `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" status <n> Test` and say which files changed.

Commits after the tested one that touch only the test paths are the test role's own regression tests. They are part of what you review.

### 2. Read the input

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" story <n>
gh pr view <pr> --json body,commits,headRefName
gh pr diff <pr>
```

Read, in this order:

1. The latest design (`story`): Context, Design, Acceptance criteria, Out of scope, Risks.
2. The PR body: the builder's criteria table, the commit list and the deviations from the design.
3. The test report (`reportUrl` from `tested`): what was tested, and any observations about behaviour the design does not cover.
4. The project's `CLAUDE.md` for its conventions.
5. The full diff, commit by commit where the commits tell a story. Open the surrounding code with Read wherever the diff alone doesn't show what a change does.

Check out the PR head (`gh pr checkout <pr>`) and run the unit tests and the regression tests once (`integration.runCommand` or `e2e.runCommand` from `.claude/pipeline.json`), so you are not taking the reports on trust.

### 3. Review

Work through the change as the senior reviewer described in Superpowers' code reviewer template (`requesting-code-review/code-reviewer.md` in the Superpowers plugin): read every line you judge, acknowledge what is done well, and calibrate severity honestly. Check, and note `file:line` for everything you find:

1. **Acceptance criteria:** each one is actually met. Cite the code that meets it.
2. **Design conformance:** the code does what the design says; deviations are listed in the PR body with a reason, and the reasons hold.
3. **Correctness and edge cases.**
4. **Error handling.**
5. **Security:** input validation, authorization, secrets, injection.
6. **Naming and consistency** with the surrounding code.
7. **Maintainability.** No early abstractions: a shared base or abstraction introduced because a second case is anticipated, rather than actually built, is a finding.
8. **Unit test quality:** tests check behaviour, not implementation. Tests that assert an old state stays gone (`not.toHaveClass('font-bold')` after the bold was dropped) pin history instead of behaviour and are a finding; regression tests for a real bug are not.
9. **Regression test quality** (the test role's tests): stable locators or commands, real assertions, no sleeps, tagged with their criteria.
10. **Performance**, where it matters.

Classify every finding:

- **Blocking:** a bug, a criterion not met, a security or data-loss risk, an unjustified departure from the design, or a test that doesn't test what it claims. The issue goes back to Build.
- **Suggestion:** anything else worth saying. It never holds up the merge.

Before deciding, list every behaviour you considered and set aside as outside the design, one line each, with the reason.

### 4. Post the verdict

Write `artifacts/<n>-<slug>/review.md` in this shape. The marker must be the first line:

```markdown
<!-- role:review -->
## <✅ APPROVE | ❌ CHANGES REQUESTED> · #<n> · <issue title>

**Reviewed:** `<head sha>` on `<branch>`, design v<n>

### Acceptance criteria

| Criterion | Where | Status |
| --- | --- | --- |
| AC1 | `greet.js:12`, `greet.js:20-22` | ✅ |

### Blocking

1. **<short title>** · `file:line`
   What is wrong, how to reproduce it, and what a fix has to achieve.

### Suggestions

1. **<short title>** · `file:line`
   What and why.

### Strengths

What is done well, specifically.

### Declined to judge

- <behaviour>: <why it is outside the design>
```

The criteria table names each criterion by its ID only; its text is already in the design and the test report. **Where** holds only `file:line` references, no explanation: a long cell squeezes the other columns until GitHub breaks their headers mid-word. Status is ✅ or ❌. Write "None." under a section that has no entries. Then post it as a review comment, and leave a one-line pointer on the issue (no `role:` marker):

```bash
gh pr review <pr> --comment --body-file artifacts/<n>-<slug>/review.md
gh issue comment <n> --body "<✅|❌> Review <APPROVE|CHANGES REQUESTED>: <PR URL>"
```

Use `--comment`, not `--approve` or `--request-changes`: GitHub refuses those on a PR opened by the same account, and the verdict lives in the marker block anyway.

### 5. Move the issue

| Verdict | Action |
| --- | --- |
| **CHANGES REQUESTED** (any blocking finding) | `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" status <n> Build`. The blocking findings are the builder's rework list. |
| **APPROVE** | Leave it in **Review**. The developer merges; merging moves it to **Done**. |

## Finish

Report to the developer in a few lines:

- the verdict and the review's URL
- per acceptance criterion: met or not
- each blocking finding in one line, and the number of suggestions
- the board column, and the next step: `/unity:build <n>` in a fresh session for rework, or "ready to merge"
