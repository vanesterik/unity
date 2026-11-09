---
name: write-system-test
description: Systematically write scripted tests of the system as a whole (integration tests, Playwright E2E tests, or both, as the project chose), from planning through implementation and stability validation, following the project's conventions. Use when the user asks to "write an integration test", "write an e2e test", "add tests for [feature]", or to codify scenarios found by test-user-story. Used by the unity:tester agent when /unity:test revisits the project's whole suite.
---

# Write System Test

Create scripted tests of the system as a whole, following the project's conventions: **integration tests** in the project's own test framework, **E2E tests** with Playwright through the browser, or both. Unit tests are not this skill's: they belong to the builder.

Based on Tim Lolkema's write-e2e-test skill, adapted for unity's design -> build -> review flow and its manual `/unity:test`. Project-specific paths now live in `CLAUDE.md` and `.claude/pipeline.json`, so this skill works across repositories.

During a test run, a unity plugin hook blocks edits outside the test paths.

## Prerequisites

Find out which kinds of tests the project writes. `/unity:init` recorded the choice as the blocks in `.claude/pipeline.json`:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" test-kinds
```

It prints `["integration"]`, `["e2e"]` or both. Write only those kinds. For each, read its section of the project's `CLAUDE.md`, and any `AGENTS.md` or `CLAUDE.md` inside its directory:

- **Integration testing** names the test directory (`integration.dir`), the framework and run command (`integration.runCommand`), and how the system under test is started or called (a process, a server, a client).
- **E2E testing** names the E2E directory and fixtures (`e2e.dir`), the translation/messages file if the project uses i18n, where UI components live, and the API layer (GraphQL or REST) and how tests set up state through it.

If the section is missing, ask the user for these locations and suggest adding them to `CLAUDE.md`. With no `.claude/pipeline.json` (used outside unity), ask which kind to write.

## Workflow

### 1. Define test requirements

**Inside the `unity:tester` agent** (project mode, for `/unity:test`), the requirements already exist: the designs of the shipped stories (`pipeline.js designs`) and the flows and smoke set the agent chose. Keep the suite small:

- one test per main flow across stories, checking each story's rule where the flow passes it
- a smoke set: the system starts with its real command and configuration, its real data loads, each entry point answers once
- every failure caused by the application stays as a failing test; the agent files a story for it

Skip anything slow, inherently visual, or already reachable by the builder's unit tests.

**Used on its own**, ask clarifying questions about scope first, for example:

- "Should this go into [existing spec] or a new spec file?"
- "Here are the suggested tests; which do you want?"
- "Should I test both success and error cases?"
- "Validate in the UI or check the backend state?"

### 2. Verify implementation details

You read the implementation to learn how to drive and observe the system. Never use it to decide what the correct behaviour is; that comes from the acceptance criteria.

**Integration tests:** find how the system is started or called (a command, a server, a client library), what it reads and writes, and how to set up state for a test without the UI. Then skip to step 3.

**E2E tests** (the rest of this step):

**Translations** (always check first, if the project uses i18n): open the messages file named in `CLAUDE.md` and look up button labels, form fields, and error and success messages. Never guess a translation key.

**UI components**: open the components for the feature.

- Identify UI elements, form fields and interactive elements.
- Check for proper accessibility attributes (labels, roles, ARIA).

**Accessibility check**: if the implementation lacks proper labels, roles or ARIA attributes, do not fix the component and do not fall back to a poor locator. Record it as a finding with the suggested fix: on its own, in your report; inside `/unity:test`, as a new story.

**API calls**: identify the GraphQL operations or REST endpoints the feature uses and what data flows through them. Note the requests the test must wait on with `page.waitForResponse`.

**Initial state**: check the API fixture and set up state through the API, not through the UI. You may extend the fixture with new setup methods, based on the existing API implementation.

### 3. Approval

Inside the `unity:tester` agent, in project mode, skip this step; the selection rules in step 1 apply.

Otherwise, present the plan: the tests you will write, what each covers and which criterion it verifies. Wait for approval.

### 4. Implement the test

**For every kind:**

- Title every test starting with "Should", and group tests in descriptive blocks (`describe`, a test class, a module), as the framework does.
- Tag every test with the issues and criteria it covers, for traceability: `@issue-42 @AC2` in the title, or the framework's own tag or marker. A flow across stories carries every issue it passes: `@issue-143 @issue-148 @AC2`.
- Keep tests parallelizable: no shared mutable state, unique test data.

**Integration tests**: in `integration.dir`, in the project's own test framework, grouped by feature.

- Drive the system the way a user or client does: run the real process, call the real server, read real output. Don't call internal functions; that is unit testing.
- Assert on what the acceptance criteria describe: output, exit codes, responses, stored state.
- Clean up what a test creates (temporary directories, processes), also when it fails.

**E2E tests**: in the E2E directory from `.claude/pipeline.json`, grouped by feature.

- Use Gherkin steps (Given, When, Then).
- Set up initial state through API calls.
- Use the locator strategy role > label > placeholder > text.
- Use the project's translation helper for all text from translation files.
- Tag with Playwright's tags: `test('Should show an inline error for an invalid email', { tag: ['@issue-42', '@AC2'] }, async ({ page }) => { ... })`.

### 5. Run the test in isolation

If the project lints its tests (for example with `eslint-plugin-playwright`), run its linter on the new files first and fix every error.

Run the test on its own several times to verify stability:

- **Integration tests:** run the new test file five times with `integration.runCommand`, narrowed to that file the way the framework allows.
- **E2E tests:** use `e2e.runSingle` from `.claude/pipeline.json` (by default `playwright test -g "<title>" --repeat-each=5 --reporter=line`).

When it fails, first decide **whose fault it is**:

- **The test is wrong** (wrong locator, missing wait, wrong translation key, timing, bad test data): fix the test and rerun. Repeat until it passes all repetitions.
- **The application is wrong** (it behaves contrary to the acceptance criterion): do not change the application and do not weaken the assertion. Keep the test as written, confirm it fails for the right reason (the assertion on the criterion, not a setup error), and report it as an application failure. This failing test is the builder's target.
- **It passes only some of the time** after the test itself is sound: report it as a flakiness finding with the failure output. Do not add retries or sleeps to hide it.

Common test-side issues:

- Incorrect locators (E2E)
- Missing waits for API requests (E2E)
- Translation key mismatches (E2E)
- A process or server not yet ready when the test starts (integration)
- Timing issues (never sleep for a fixed time, such as `waitForTimeout`)

### 6. Final checklist

Before completing, verify for every test:

- [ ] Only the kinds `test-kinds` lists, each in its own directory
- [ ] Inside a descriptive block, title starts with "Should"
- [ ] Tagged with every `@issue-<n>` and criterion ID it covers
- [ ] Runs in isolation, repeatedly, and in parallel with other tests
- [ ] Passing tests pass every repetition; failing tests fail on the criterion assertion, for an application reason that is documented
- [ ] No application code or unit tests were modified

For integration tests, also:

- [ ] Drives the real process or server, not internal functions
- [ ] Cleans up what it creates, also on failure

For E2E tests, also:

- [ ] Test follows Gherkin structure (Given, When, Then)
- [ ] Initial state set up through API calls
- [ ] Relevant API requests are awaited with `page.waitForResponse`
- [ ] Locators use role > label > placeholder > text
- [ ] No `page.locator` filtering where `getBy*` options work
- [ ] All UI text comes through the translation helper (if the project uses i18n)
- [ ] No `waitForTimeout` or `networkidle`
