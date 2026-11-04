---
name: ship
description: Runs build, test and review on an issue one after the other, each as its own agent in a fresh context, for as long as each one moves the issue on. Starts from the issue's current column and stops at the first role that doesn't. Run manually as /unity:ship <issue>.
disable-model-invocation: true
allowed-tools: Agent, Bash
---

# Ship

Take an issue from its approved design to a reviewed pull request, without the developer starting each role. Each role runs as its own agent with a fresh context, so no role sees another's reasoning or this conversation. This session only starts them, reads the board in between, and collects their reports. The board decides whether to go on, not a reading of the reports.

ISSUE: $ARGUMENTS (an issue number or `#42`)

If ISSUE is empty, stop and ask which issue to ship. Don't pick one from the board.

## Run

Note the time the run starts, for the summary at the end:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

Then repeat until a step says stop:

1. Read the issue's column:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" check <n> Build
   ```

   It prints the column as JSON, and exits non-zero when the issue is in another column. That is not an error here.

2. Act on the column:

   | Column | Action |
   | --- | --- |
   | **Build** | Start the `unity:builder` agent. |
   | **Test** | Start the `unity:tester` agent. |
   | **Review** | Start the `unity:reviewer` agent. |
   | **Backlog** or **Design** | Stop: the design isn't approved yet. The next step is `/unity:design <n>`. |
   | **Done** | Stop: there is nothing left to do. |

   Start each agent with the prompt `Issue: <n>`, and wait for it to finish before you read the column again. Run one agent at a time.

3. Stop after the reviewer, whatever its verdict, and when a role ran but the issue didn't move on to the next column (from Build to Test, or from Test to Review). Every role runs at most once per `/unity:ship`, so a failed test or a review with blocking findings never starts a rework loop by itself.

Don't do any of a role's work yourself, and don't run a role again when it stopped: a stop is for the developer to look at.

## Finish

Print the run's summary. The script reads what each role posted since the start time, with the column and the next step:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" summary <n> --since <start time> --markdown
```

Print its output exactly as it is, without adding to it, rewording it or putting it in a code block.

Unless the run ended in **Review** with an approval, add the report of the role that stopped the run below the summary, as it is, so the developer doesn't have to look it up. Its report says why it stopped and what the developer has to decide.

When the run stopped short of an approval, the summary also lists the commits that landed since a role last signed off (a build handover, a passing test or an approval), so the developer sees where a failure may come from. That is the whole output: the summary, and the stopping role's report when there is one. Don't add anything before, between or after them, and don't look into the branch, the commits or the code yourself: what the developer needs from them is in the summary.
