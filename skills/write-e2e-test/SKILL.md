---
name: write-e2e-test
description: Systematically write scripted Playwright E2E or integration tests, from planning through implementation and stability validation, following the project's conventions. Use when the user asks to "write an e2e test", "add e2e tests for [feature]", or to codify scenarios found by test-user-story. Used by /agent-team:qa to turn explored scenarios into regression tests.
---

# Write E2E Test

Create scripted end-to-end or integration tests with Playwright, following the project's conventions.

Based on Tim Lolkema's write-e2e-test skill, adapted for the architect -> build -> qa -> review pipeline. Project-specific paths now live in `CLAUDE.md` (section **E2E testing**) and `.claude/pipeline.json` (`e2e`), so this skill works across repositories.

The agent-team plugin enforces two things with hooks: every edit to a file in `e2e.dir` is linted (`e2e.lintCommand`; lint errors block until fixed), and during a QA run edits outside the test paths are blocked.

## Prerequisites

Read the **E2E testing** section of the project's `CLAUDE.md`, and any `AGENTS.md` or `CLAUDE.md` inside the E2E directory. It names:

- the E2E test directory and fixtures (`e2e.dir` in `.claude/pipeline.json`)
- the translation/messages file, if the project uses i18n
- where UI components live
- the API layer (GraphQL or REST) and how tests set up state through it

If that section is missing, ask the user for these locations and suggest adding them to `CLAUDE.md`.

## Workflow

### 1. Define test requirements

**Inside /agent-team:qa**, the requirements already exist: the cases executed by `test-user-story` and the acceptance criteria. Select the ones worth codifying:

- every case that verifies an acceptance criterion
- every FAIL caused by the application (the test becomes the builder's target)
- exploratory cases only if they protect against a realistic regression

Skip cases that are slow, inherently visual, or already covered by the builder's unit tests.

**Used on its own**, ask clarifying questions about scope first, for example:

- "Should this go into [existing spec] or a new spec file?"
- "Here are the suggested tests; which do you want?"
- "Should I test both success and error cases?"
- "Validate in the UI or check the backend state?"

### 2. Verify implementation details

You read the implementation to learn how to drive and observe the UI. Never use it to decide what the correct behaviour is; that comes from the acceptance criteria.

**Translations** (always check first, if the project uses i18n): open the messages file named in `CLAUDE.md` and look up button labels, form fields, and error and success messages. Never guess a translation key.

**UI components**: open the components for the feature.

- Identify UI elements, form fields and interactive elements.
- Check for proper accessibility attributes (labels, roles, ARIA).

**Accessibility check**: if the implementation lacks proper labels, roles or ARIA attributes, do not fix the component and do not fall back to a poor locator. Record it as a finding (a FAIL or a note in the QA report) with the suggested fix, so it goes back to the builder.

**API calls**: identify the GraphQL operations or REST endpoints the feature uses and what data flows through them. Note the requests the test must wait on with `page.waitForResponse`.

**Initial state**: check the API fixture and set up state through the API, not through the UI. You may extend the fixture with new setup methods, based on the existing API implementation.

### 3. Approval

Inside /agent-team:qa in pipeline mode, skip this step; the selection rules in step 1 apply.

Otherwise, present the plan: the tests you will write, what each covers and which criterion it verifies. Wait for approval.

### 4. Implement the test

**Location**: the E2E directory from `.claude/pipeline.json`, grouped by feature.

- Use Gherkin steps (Given, When, Then).
- Set up initial state through API calls.
- Use the locator strategy role > label > placeholder > text.
- Use the project's translation helper for all text from translation files.
- Group tests in descriptive `describe` blocks.
- Title every test starting with "Should".
- Tag tests with the issue and criteria for traceability: `test('Should show an inline error for an invalid email', { tag: ['@issue-42', '@AC2'] }, async ({ page }) => { ... })`.
- Keep tests parallelizable: no shared mutable state, unique test data.

### 5. Run the test in isolation

Run the test on its own several times to verify stability, using `e2e.runSingle` from `.claude/pipeline.json` (by default `playwright test -g "<title>" --repeat-each=5 --reporter=line`).

When it fails, first decide **whose fault it is**:

- **The test is wrong** (wrong locator, missing wait, wrong translation key, timing, bad test data): fix the test and rerun. Repeat until it passes all repetitions.
- **The application is wrong** (it behaves contrary to the acceptance criterion): do not change the application and do not weaken the assertion. Keep the test as written, confirm it fails for the right reason (the assertion on the criterion, not a setup error), and report it as an application failure. This failing test is the builder's target.
- **It passes only some of the time** after the test itself is sound: report it as a flakiness finding with the failure output. Do not add retries or sleeps to hide it.

Common test-side issues:

- Incorrect locators
- Missing waits for API requests
- Translation key mismatches
- Timing issues (never use `waitForTimeout`)

### 6. Final checklist

Before completing, verify:

- [ ] Test follows Gherkin structure (Given, When, Then)
- [ ] Initial state set up through API calls
- [ ] Relevant API requests are awaited with `page.waitForResponse`
- [ ] Locators use role > label > placeholder > text
- [ ] No `page.locator` filtering where `getBy*` options work
- [ ] All UI text comes through the translation helper (if the project uses i18n)
- [ ] No `waitForTimeout` or `networkidle`
- [ ] Inside a descriptive `describe` block, title starts with "Should"
- [ ] Tagged with `@issue-<n>` and its criterion IDs
- [ ] Runs in isolation, repeatedly, and in parallel with other tests
- [ ] Passing tests pass every repetition; failing tests fail on the criterion assertion, for an application reason that is documented
- [ ] No application code or unit tests were modified
