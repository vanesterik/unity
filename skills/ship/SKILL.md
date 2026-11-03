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

Repeat until a step says stop:

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

Report one line per role that ran: the role, its result (for example "4 commits, unit tests 30/30", "PASS, 8/8 criteria", "APPROVE, 1 suggestion") and the link it posted. Then give the column and the next step:

| Ended in | Next step |
| --- | --- |
| **Review**, approved | Ready to merge: read the pull request commit by commit and merge it with a rebase. |
| **Build**, after a failed test or changes requested | `/unity:ship <n>` again: the builder reworks the findings, and test and review run again. |
| **Test**, INCOMPLETE | The tester's report says which criteria are untested. Test them another way, accept the gap, or send the issue back to `/unity:design <n>`. Then `/unity:ship <n>` runs the rest. |
| **Test**, after review | The pull request changed after testing: `/unity:ship <n>` tests and reviews it again. |
| **Build**, the builder stopped | Its report says why. |

Below the table, add the report of the role that stopped the run, as it is, so the developer doesn't have to look it up.
