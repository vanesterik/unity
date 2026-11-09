---
name: status
description: Read-only overview of the unity board - every issue per column, its pull request, its latest role result and the next command to run, plus warnings for what the columns don't show (a PR without an issue, a merged PR whose issue is still open). Use when the developer asks where things stand or what to run next. Run as /unity:status.
allowed-tools: Bash
---

# Status

Show where every issue stands, without opening GitHub. This only reads: it moves nothing, changes nothing, and runs none of the next steps it shows.

## Steps

1. Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" board --markdown
   ```

   If it reports a missing `.claude/pipeline.json`, point the developer to `/unity:init`.

2. Print its output exactly as it is, and nothing else: no summary, no reordering, no added advice. The script writes the whole overview (the issues per column with their pull request, latest result and next step, the empty columns, the Done count and the warnings), so it reads the same every time for the same board.

For the same data as JSON, for a script or another skill, run `pipeline.js board` without `--markdown`.
