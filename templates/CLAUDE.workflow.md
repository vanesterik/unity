<!-- unity:workflow:start -->
## Team workflow (unity)

This project is built by one developer and Claude in four roles, each in a **fresh context**: `/unity:design` -> `/unity:build` -> `/unity:test` -> `/unity:review`. Each role is named after the board column it works in. GitHub is the only handoff between roles.

### Board

GitHub Project columns are the workflow state. IDs live in `.claude/pipeline.json` (written by `/unity:init`). Picking an issue with `/unity:design` sets the flow in motion; from then on each role moves the issue to the next column, and the developer starts the next role in a fresh session.

| Column | Meaning | Moved there by |
| --- | --- | --- |
| Backlog | Not picked up yet | the developer |
| Design | Design and plan in progress, with the developer | `/unity:design` at start |
| Build | Design approved; implementation and unit tests (TDD), also rework | `/unity:design` once the developer approves the design in conversation; `/unity:test` and `/unity:review` on rejection |
| Test | PR open, integration/E2E testing | `/unity:build` when the PR is open |
| Review | Tests passed, final code review | `/unity:test` on PASS |
| Done | Merged | GitHub automation on merge |

The developer's approval of the design is the one human gate: `/unity:design` moves an issue to Build only after it, and `/unity:build` works only on issues in Build.

### Conventions

- **Branch:** `feature/<issue>-<slug>` (e.g. `feature/42-guest-checkout`).
- **PR body** contains `Closes #<issue>`.
- **Design and plan live in the issue, not in the repository.** The latest `role:design` comment holds both. This overrides any convention that commits specs or plans as files (such as `docs/specs/` and `docs/plans/`), and the file-saving steps of planning skills: post the content as the comment instead.
- **Role comments** start with a hidden marker so the next role can find them: `<!-- role:design v1 -->`, `<!-- role:build -->`, `<!-- role:test -->`, `<!-- role:review -->`. A revised design is a new comment with a higher version; the latest one counts.
- **Acceptance criteria** are part of the design comment, numbered and testable from the outside:

  ```markdown
  <!-- role:design v1 -->
  ## Design
  ...
  ## Acceptance criteria
  - AC1: A guest can complete checkout without creating an account
  - AC2: An invalid email address shows an inline error and blocks submission
  ```

  Every role refers to criteria by ID: tests are tagged `@AC2`, the test role reports coverage per criterion, review checks that each one is met.

### Testing responsibilities

- **Build** owns unit tests, written test-first.
- **Test** owns integration and end-to-end tests, and never changes application code or unit tests.

### E2E testing

<!-- Filled in by /unity:init; adjust as needed. write-e2e-test reads this section. -->

- E2E directory: `e2e/` (fixtures in `e2e/fixtures/`, API fixture in `e2e/fixtures/api.ts`)
- Translations: `<path to messages file, or "none">`; helper: `<translation helper name>`
- UI components: `<path>`
- API layer: `<GraphQL services / REST routes path>`
- Start the app for testing: see `test.start` in `.claude/pipeline.json`
- Test users and data: `<where they come from>`
<!-- unity:workflow:end -->
