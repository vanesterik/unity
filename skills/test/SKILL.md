---
name: test
description: Tests the whole project, when the developer chooses (for example at the end of an epic). Runs the tester agent in a fresh context; it revisits the integration or E2E suite, opens a pull request with the changes, and files every defect as a new story in Backlog. Not part of a story's flow. Run manually as /unity:test, or /unity:test --all to read every shipped story again.
disable-model-invocation: true
allowed-tools: Agent, Bash
---

# Test

Test the whole project. Stories ship through design → build → review without testing the running system; this command is where that happens, as often as the developer chooses. The work is the `unity:tester` agent's, in a fresh context: nothing of this conversation reaches it.

ARGS: $ARGUMENTS (empty, or `--all`)

By default the tester reads the designs of the stories closed since the last test run, so a run costs what was shipped since, not the project's whole history. With `--all` it reads every shipped story again, for when the suite needs a review from the ground up. A project's first run reads them all either way.

1. Start the `unity:tester` agent with the prompt `Test the whole project`, or with `Test the whole project, reading every shipped story` when ARGS is `--all`, and wait for it to finish. Don't do any of its work yourself, before or after.
2. Show its report as it is.
3. End with the next steps:
   - Review the test run's pull request commit by commit, and merge it.
   - Design each new story with `/unity:design <n>`; the builder picks it up once its design is approved.
