---
name: get-user-story
description: Retrieve a GitHub issue as a testable user story - the issue text, the latest design and its numbered acceptance criteria (AC1, AC2, ...), plus branch, commit and linked PR. Use when a skill or the user refers to an issue or ticket by number, URL, or "this branch".
allowed-tools: Bash
---

# Get User Story

Fetch the user story for an issue in the format the role skills expect.

## Input

ISSUE: $ARGUMENTS (an issue number, `#42`, an issue or PR URL, or empty for "the issue of the current branch")

## Steps

1. Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" story $ARGUMENTS
   ```

   This returns JSON with `number`, `title`, `url`, `body`, `design` (the latest `<!-- role:design ... -->` comment), `criteria`, `criteriaSource`, `branch`, `commit` and `pr`.

2. If the command cannot determine the issue, run `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" queue Test` and ask the user which issue they mean. Do not guess.

   If it reports a missing `.claude/pipeline.json`, the project is not set up yet: point the user to `/unity:init`.

3. Check the criteria:
   - `criteriaSource: "design-comment"`: use them as they are.
   - `criteriaSource: "issue-body"`: use them, but say the design comment has no acceptance criteria.
   - `criteria` is empty: stop and report that the issue has no numbered acceptance criteria. The fix belongs in `/unity:design`. Do not invent criteria from the description, because the test role would then be testing its own interpretation instead of what was agreed.

## Output

Return the story as:

```
USER STORY #<number>: <title>
URL: <url>
Branch: <branch> @ <commit>    PR: <pr.url or "none">

Acceptance criteria (<criteriaSource>, design v<designVersion>):
- AC1: ...
- AC2: ...

Context:
<issue body, then the design comment>
```

Keep the criterion IDs exactly as written. Every later step refers to them.
