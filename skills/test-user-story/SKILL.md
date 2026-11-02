---
name: test-user-story
description: Exploratory, agentic testing of a user story or GitHub issue in a real browser using the 'playwright-cli' skill. Derives test cases from the acceptance criteria, executes them, and produces an evidence report with criteria coverage. Trigger when the user asks to test a user story or issue, or to verify local development changes. Also used by /unity:test.
allowed-tools: Bash
---

# Test User Story

Validate a user story by deriving test cases from its acceptance criteria and executing each one with the `playwright-cli` skill. Produce evidence of what was actually done, not just a verdict.

Based on Tim Lolkema's test-user-story skill, adapted for the design -> build -> test -> review pipeline.

## Variables

INPUT: the full text of $ARGUMENTS
PIPELINE_MODE: true when this skill is called by `/unity:test` (the caller passes `pipeline` plus the issue number, environment URL and evidence type). In pipeline mode, ask no questions and use the values passed in.

- If INPUT is an issue number, issue URL, or "this branch", use the `unity:get-user-story` skill to retrieve the story and its acceptance criteria.
- If INPUT is free text, treat it as the story. Extract or ask for numbered acceptance criteria (AC1, AC2, ...) before continuing.
- If INPUT is empty, ask the user which story or issue to test.

## Workflow

### Step 1 - Derive test cases

Derive a numbered list of test cases from the acceptance criteria. Each test case must have:

- A short name (e.g. "Guest pays with a valid card")
- The criterion IDs it verifies (`criteria: ["AC1"]`); at least one
- A clear goal in one sentence
- The specific steps to perform
- The expected outcome that decides pass or fail

Rules:

- Every acceptance criterion must be covered by at least one case. If a criterion cannot be tested through the UI (for example "an email is sent"), say so and leave it uncovered. The report will mark it UNTESTED rather than hide it.
- Combine related checks into a single case when they share the same user flow. Only create separate cases for different user flows.
- Derive expectations from the criteria, not from the code. Reading the implementation is fine for how to drive the UI, never for deciding what the correct behaviour is.
- After the criteria cases, add a small number of exploratory cases (error paths, boundaries, keyboard navigation, validation states) where they add real value. Link them to the criterion they stress. If one fits no criterion, add an extra criterion `{ "id": "X", "text": "Exploratory checks beyond the acceptance criteria" }` to the report data.

Do not proceed to Step 2 until this list is complete.

### Step 2 - Selection

In PIPELINE_MODE, skip the questions: execute all cases, use the environment URL and evidence type passed in, and continue.

Otherwise, ask in one multiple-choice round:

- Which test cases to execute (default: all)
- Which environment, from `<repo>/environments.json`; if the project has none, ask for the URL
- Which evidence type: `screenshots` or `videos` (default: `screenshots`)

### Step 3 - Execute test cases

Create the evidence directory, named after the issue: `<issue-number>-<slug>`, lowercase, hyphens only (e.g. `42-guest-checkout`). Without an issue, use the slug alone.

```bash
mkdir -p artifacts/<run-name>
```

Use this directory for all evidence, the run data, and the report. Capture only the selected evidence type unless that type is technically impossible.

#### Retry before FAIL

If a case fails, rerun it once from a clean state before recording FAIL.

- Fails again: record FAIL.
- Passes on the retry: record PASS and set `"flaky"` on the case to a short description of what failed the first time. This is a finding, not noise.

Record the first failure's evidence either way.

#### Evidence

For every screenshot, including fallback screenshots:

- Identify all elements needed to demonstrate the checkpoint's action and its expected or actual result, including relevant inputs, messages, totals and surrounding context. Frame the capture around those elements, not merely the top of the page or the current viewport.
- Wait for the relevant UI to finish rendering, then scroll the relevant elements into view. Use a viewport or element screenshot only when it includes all relevant information without clipping or hiding it.
- If relevant content extends beyond the viewport, capture a full-page screenshot using `playwright-cli run-code "async page => { await page.screenshot({ path: 'artifacts/<run-name>/<screenshot-name>.png', fullPage: true }); }"`. Full-page capture does not reveal content hidden inside independently scrollable panels, so scroll those as needed. If one image cannot show everything legibly, take complementary screenshots for the same checkpoint and label each with the step name and the view shown.
- Inspect every saved image before adding it to the report. Confirm that all relevant elements are visible, readable, and not clipped or obscured by overlays or sticky headers. If evidence is incomplete, adjust the framing and retake it. Do not change the tested state or dismiss a relevant failure message to improve the image.

If `screenshots` was selected:

- Capture a screenshot at each meaningful checkpoint, including any failure state.
- Store a case's screenshots in execution order in its `evidence` array as `{ "file": "relative.png", "step": "Name of the step shown" }`. Always give the actual step name; not every step has a screenshot, so never infer it from position.

If `videos` was selected:

1. First explore and execute the complete case normally with `playwright-cli` to find stable locators, actions, assertions and timing.
2. Then run it again with video recording, using annotations and pauses (every annotation = 2-second pause).

Always stop video recording before reporting, including on failures. If the selected evidence type cannot be captured, use the other one and say why in the report.

For failures, also capture the JavaScript console errors at the moment of failure.

### Step 4 - Generate the report

Write `artifacts/<run-name>/report-data.json` in this shape:

```json
{
  "issue": { "number": 42, "title": "Guest checkout", "url": "https://github.com/<owner>/<repo>/issues/42" },
  "branch": "feature/42-guest-checkout",
  "commit": "abc1234",
  "storyName": "Guest checkout",
  "environment": "local",
  "environmentUrl": "http://localhost:4042",
  "criteria": [
    { "id": "AC1", "text": "A guest can pay without creating an account" },
    { "id": "AC2", "text": "An invalid email shows an inline error" }
  ],
  "cases": [
    {
      "number": 1,
      "name": "Guest pays with a valid card",
      "criteria": ["AC1"],
      "goal": "A guest completes checkout without an account",
      "status": "PASS",
      "steps": ["Add product to cart", "Choose guest checkout", "Pay"],
      "evidence": [{ "file": "01-cart.png", "step": "Add product to cart" }],
      "flaky": "Only if it passed on retry: what failed the first time"
    },
    {
      "number": 2,
      "name": "Invalid email",
      "criteria": ["AC2"],
      "goal": "An invalid email is rejected inline",
      "status": "FAIL",
      "steps": ["Enter 'a@' as email", "Submit"],
      "evidence": [{ "file": "02-error.png", "step": "Submit" }],
      "failedStep": "Submit",
      "expected": "Inline error under the email field",
      "actual": "Form submits and shows the payment step",
      "consoleErrors": ["..."]
    }
  ]
}
```

- `status` is `PASS`, `FAIL` or `SKIPPED`. A FAIL case must have `expected` and `actual`.
- Do not supply `overallStatus`, `passedCases` or `totalCases`. The generator computes them: any FAIL is FAILURE; an untested criterion or a skipped case is INCOMPLETE; otherwise PASS.
- Use relative evidence paths so the directory stays portable. Use an empty array or omit `evidence` when none was captured (for example for CLI or API checks, where the command output goes into `steps` and `actual`).

Then run the generator exactly like this:

```bash
node "${CLAUDE_SKILL_DIR}/references/generate-report.js" artifacts/<run-name>/report-data.json
```

It validates the data, refuses unknown criterion IDs and missing evidence files, and writes:

- `index.html`: the visual evidence report, with an acceptance-criteria coverage table
- `summary.md`: the same result as GitHub markdown, starting with `<!-- role:test -->`, ready to post on the PR

Before reporting completion, verify:

- The generator exited successfully.
- Each screenshot, or complementary set for one checkpoint, visibly includes everything relevant to its labeled step. Reject top-of-page-only or clipped captures.
- Every acceptance criterion is either covered by an executed case or deliberately left UNTESTED with the reason stated.

Open `index.html` in the default browser only when not in PIPELINE_MODE:

```bash
node -e "const{execSync}=require('child_process');const c=process.platform;const r='artifacts/<run-name>/index.html';execSync(c==='win32'?'start \"\" \"'+r+'\"':c==='darwin'?'open '+r:'xdg-open '+r,{cwd:process.cwd()})"
```

### Step 5 - Report

Print the contents of `summary.md`, followed by the absolute `file://` path to `index.html`. Do not write a separate summary by hand, so the result is identical in every run.

In PIPELINE_MODE, also return the generator's JSON line (`overallStatus` and the paths) to the caller.
