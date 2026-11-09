---
name: review
description: Review phase of the design -> build -> review flow. Runs the reviewer agent on one issue in a fresh context. Run manually as /unity:review <issue>.
disable-model-invocation: true
allowed-tools: Agent, Bash
---

# Review

Run the review role on one issue. The role itself is the `unity:reviewer` agent, which runs in a fresh context: nothing of this conversation reaches it, and GitHub is its only input. To run build and review one after the other, use `/unity:ship` instead.

ISSUE: $ARGUMENTS (a number, `#42`, an issue or PR URL, or empty)

1. Start the `unity:reviewer` agent with the prompt `Issue: <ISSUE, or "none given">`, and wait for it to finish. Don't do any of its work yourself, before or after.
2. Show its report as it is.
3. Read the issue's column (the number from ISSUE, or from the report):

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" check <n> Review
   ```

   It prints the column as JSON, and exits non-zero when the issue is in another one. That is not an error here.

4. End with the next step for that column:

   | Column | Next step |
   | --- | --- |
   | **Review** | Ready to merge: read the pull request commit by commit and merge it with a rebase. |
   | **Build** | Changes requested: `/unity:build <n>` reworks them, or `/unity:ship <n>` reworks them and runs the rest. |
   | Any other | The agent stopped before its work; its report says why. |
