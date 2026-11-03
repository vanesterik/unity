---
name: status
description: Read-only overview of the unity board - every issue per column, its pull request, its latest role result and the next command to run, plus warnings for what the columns don't show (a test result that no longer covers the PR, a PR without an issue, a merged PR whose issue is still open). Use when the developer asks where things stand or what to run next. Run as /unity:status.
allowed-tools: Bash
---

# Status

Show where every issue stands, without opening GitHub. This only reads: it moves nothing, changes nothing, and runs none of the next steps it shows.

## Steps

1. Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" board
   ```

   It returns JSON: `columns` in board order, each with its `issues` (`number`, `title`, `url`, `next`, and for Build, Test and Review also `pr` and `latest`), and `warnings` (`type`, `message`). If it reports a missing `.claude/pipeline.json`, point the developer to `/unity:init`.

2. Print the overview in this format, and nothing else:

   ```markdown
   **Backlog** (1)
   - #17 Guest checkout → `/unity:design 17`

   **Build** (1)
   - #18 Greeting count · PR #20 (draft) · 🔨 Built → `/unity:ship 18`

   **Review** (1)
   - #15 Custom greeting word · PR #16 · ✅ Review APPROVE on `6e43f62` → ready to merge

   Empty: Design, Test · Done: 9

   **Warnings**
   - ⚠️ #19 is still open, but PR #22 that closes it is merged: <url>
   ```

   - List the columns that have issues, in the order given, and leave out Done. Name the empty ones on one line, with the number of issues in Done.
   - The result comes from `latest`: `✅`, `❌` or `⚠️` (PASS or APPROVE, FAILURE or CHANGES REQUESTED, INCOMPLETE), then `Test` or `Review`, the status and `on <commit>`. A build result is `🔨 Built`, and no `latest` is `no result yet`. Add `(draft)` after a draft PR.
   - Show `next` as it is: a command in backticks, or its text (`ready to merge`, `decide on the untested criteria`).
   - Give each warning's `message` as it is, and leave out the **Warnings** heading when there are none.

3. After a `merged-but-open` warning, add one line: close the issue by hand, with a comment saying which pull request delivered it and how each acceptance criterion was met.
