<!-- unity:workflow:start -->
## Team workflow (unity)

This project is built by one developer and Claude in four roles, each in a **fresh context**: `/unity:architect` -> `/unity:build` -> `/unity:qa` -> `/unity:review`. GitHub is the only handoff between roles.

### Board

GitHub Project columns are the workflow state. IDs live in `.claude/pipeline.json` (written by `/unity:init`). Items are moved by the role skills, or by you on the board.

| Column | Meaning | Moved there by |
| --- | --- | --- |
| Backlog | Not ready for work | the developer |
| Design | Architect at work | the developer |
| Ready to Build | Design approved | **the developer only**, after reading the design |
| Building | Implementation, unit tests (TDD) | `/build` at start; `/qa` and `/review` on rejection |
| QA | PR open, integration/E2E testing | `/build` when the PR is open |
| Review | QA passed, final review | `/qa` on PASS |
| Done | Merged | GitHub automation on merge |

### Conventions

- **Branch:** `feature/<issue>-<slug>` (e.g. `feature/42-guest-checkout`).
- **PR body** contains `Closes #<issue>`.
- **Role comments** start with a hidden marker so the next role can find them: `<!-- role:architect v1 -->`, `<!-- role:qa -->`, `<!-- role:review -->`. A revised design is a new comment with a higher version; the latest one counts.
- **Acceptance criteria** are part of the architect comment, numbered and testable from the outside:

  ```markdown
  <!-- role:architect v1 -->
  ## Design
  ...
  ## Acceptance criteria
  - AC1: A guest can complete checkout without creating an account
  - AC2: An invalid email address shows an inline error and blocks submission
  ```

  Every role refers to criteria by ID: tests are tagged `@AC2`, QA reports coverage per criterion, review checks that each one is met.

### Testing responsibilities

- **Build** owns unit tests, written test-first.
- **QA** owns integration and end-to-end tests, and never changes application code or unit tests.

### E2E testing

<!-- Filled in by /unity:init; adjust as needed. write-e2e-test reads this section. -->

- E2E directory: `e2e/` (fixtures in `e2e/fixtures/`, API fixture in `e2e/fixtures/api.ts`)
- Translations: `<path to messages file, or "none">`; helper: `<translation helper name>`
- UI components: `<path>`
- API layer: `<GraphQL services / REST routes path>`
- Start the app for QA: see `qa.start` in `.claude/pipeline.json`
- Test users and data: `<where they come from>`
<!-- unity:workflow:end -->
