---
name: autopilot
description: Builds, tests, reviews and merges every approved story in the Build column, one story at a time and top first, each role as its own agent in a fresh context. Merges only through pipeline.js merge, stops the whole run at the first story that can't get there, and ends with a digest written by a script. Run manually as /unity:autopilot.
disable-model-invocation: true
allowed-tools: Agent, Bash
---

# Autopilot

Take every story whose design the developer approved, in **Build**, all the way to `main` without the developer: build, test, review and merge, one story after another. The developer's approval of the design is the one human gate. Autopilot replaces the merge gate with `pipeline.js merge`, which merges only when the tester and the reviewer signed off on the commit being merged and CI is green.

This session only starts the agents, reads the board between them, and calls `pipeline.js`. The board and the scripts decide whether to go on, not a reading of the reports. The developer has left the session running and is not watching: never ask them anything during the run.

This skill takes no arguments. Running it is the opt-in.

## Rules

- **Never do a role's work yourself**, before, between or after the agents. Don't fix code, tests, the branch or the pull request.
- **Merge only with `pipeline.js merge`.** Never run `gh pr merge` or push to `main` yourself.
- **One agent at a time**, one story at a time.
- **Only take stories from Build.** Never touch an issue in Backlog or Design, and never start a story that is in Test or Review when the run starts: the developer may be handling it.
- **The first story that can't get to `main` ends the run.** Later stories may depend on it.
- Script output is printed exactly as the script writes it: no rewording, no code block, nothing added.

In the commands below, `pipeline.js` stands for `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js"`.

## Run

### 1. Start

Note the start time. Every count and the digest are taken from it:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ
```

### 2. Come back to a stopped run

```bash
pipeline.js resume
```

It prints what to do with the stories earlier runs stopped at (label `autopilot:stopped`) and clears the labels it no longer needs:

- `blocked` isn't empty: a stopped story is outside Build and Done, so the developer hasn't dealt with it yet. Start nothing. Print `pipeline.js digest --since <start> --blocked --markdown` and end the run.
- `resume` is a number: that story goes first, with a fresh rework budget.
- Otherwise go on with the queue.

### 3. Take the next story

Unless step 2 named a story to resume, read the queue:

```bash
pipeline.js queue Build
```

Take the first issue in the list: the top of the column. If the list is empty, go to **Finish**.

### 4. Ship the story

Repeat until the story merges or stops:

1. Read the issue's column:

   ```bash
   pipeline.js check <n> Build
   ```

   It prints the column as JSON and exits non-zero when the issue is in another column. That is not an error here.

2. Act on the column:

   | Column | Action |
   | --- | --- |
   | **Build** | Start the `unity:builder` agent. |
   | **Test** | Start the `unity:tester` agent. |
   | **Review** | Start the `unity:reviewer` agent. |
   | **Backlog**, **Design** or **Done** | Stop the story: `#<n> moved to <column> during the run`. |

   Start each agent with the prompt `Issue: <n>` and wait for it to finish before you read the column again.

3. After each agent, read the column again and decide:

   | Agent | Column after it | Next |
   | --- | --- | --- |
   | builder | Test | Start the tester. |
   | builder | anything else | Stop the story. The reason is the builder's own stop, in one line. |
   | tester | Review | Start the reviewer. |
   | tester | Build | A failed test: check the rework budget (below). |
   | tester | Test | Stop the story: `criteria left untested`. |
   | reviewer | Review | Merge (below). `pipeline.js merge` checks the approval itself. |
   | reviewer | Build | Blocking findings: check the rework budget (below). |
   | any | another column | Stop the story. The reason is the role's own stop, in one line. |

   **Rework budget.** Run:

   ```bash
   pipeline.js reworks <n> --since <start>
   ```

   If `reworks` is less than `max`, start the builder again: it reworks the findings, then the tester and reviewer run again. Otherwise stop the story: `failed <test|review> after <max> reworks`.

   **Merge.** Run:

   ```bash
   pipeline.js merge <n>
   ```

   It waits up to 15 minutes for running CI checks. On exit 0 the story is merged: `Closes #<n>` closes the issue and the board moves it to Done. Go back to step 3 for the next story; the queue is read again, so a story approved during the run is included. On a non-zero exit, stop the story with its `reasons`, joined with `; `. A refusal by GitHub, such as branch protection that requires another reviewer, is one of those reasons.

### 5. Stop a story

When a story stops, record why on the issue, with the URL of the result that stopped it (the failing test, the review, or none):

```bash
pipeline.js stop <n> --reason "<reason>" [--url <url>]
```

Then print the digest and, below it, the stopping role's report as the agent returned it, unchanged:

```bash
pipeline.js digest --since <start> --stopped <n> --markdown
```

That ends the run. The story stays in the column it is in; nothing is reverted.

## Finish

When the queue is empty, print the digest and end the run:

```bash
pipeline.js digest --since <start> --markdown
```

That is the whole output of a run that emptied the queue: the digest, nothing before or after it. Don't look into the branches, commits or code yourself: what the developer needs is in the digest.
