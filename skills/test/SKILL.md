---
name: test
description: Test phase of the design -> build -> test -> review pipeline. Runs the tester agent on one issue in a fresh context, running every case. Run manually as /unity:test <issue>.
disable-model-invocation: true
allowed-tools: Agent, Bash
---

# Test

Run the test role on one issue. The role itself is the `unity:tester` agent, which runs in a fresh context: nothing of this conversation reaches it, and GitHub is its only input.

ISSUE: $ARGUMENTS (a number, `#42`, an issue or PR URL, or empty)

1. Start the `unity:tester` agent with the prompt `Issue: <ISSUE, or "none given">`, and wait for it to finish. Don't do any of its work yourself, before or after.
2. Show its report as it is.
3. Read the issue's column (the number from ISSUE, or from the report):

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" check <n> Review
   ```

   It prints the column as JSON, and exits non-zero when the issue is in another one. That is not an error here.

4. End with the next step for that column:

   | Column | Next step |
   | --- | --- |
   | **Review** | `/unity:review <n>` |
   | **Build** | The test failed: `/unity:build <n>` reworks it. |
   | **Test** | The run is INCOMPLETE: the report says which criteria are untested. Test them another way, accept the gap, or send the issue back to `/unity:design <n>`. |
   | Any other | The agent stopped before its work; its report says why. |
