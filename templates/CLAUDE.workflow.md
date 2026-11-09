<!-- unity:workflow:start -->
## Team workflow (unity)

This project is built by one developer and Claude in three roles per story: design -> build -> review. Design is a conversation with the developer (`/unity:design`). Build and review each run as their own agent with a **fresh context** (`unity:builder`, `unity:reviewer`), started one after the other by `/unity:ship`, or one at a time by `/unity:build` and `/unity:review`. `/unity:autopilot` does the same for every story in Build, top first, and also merges each one, but only through `pipeline.js merge`, which requires an approval on the pull request's head and green CI. The first story that can't get there ends the run. Each role is named after the board column it works in. GitHub is the only handoff between roles.

Testing the running system is not part of a story. The developer runs `/unity:test` when they choose (for example at the end of an epic): the `unity:tester` agent tests the whole project against the designs of the shipped stories, revisits the integration or E2E suite in its own pull request, and files every defect as a new story in Backlog.

### Board

GitHub Project columns are the workflow state. IDs live in `.claude/pipeline.json` (written by `/unity:init`). Picking an issue with `/unity:design` sets the flow in motion; from then on each role moves the issue to the next column, and `/unity:ship` starts the next agent only when the issue moved on. `/unity:status` shows every issue per column with the next command to run.

| Column | Meaning | Moved there by |
| --- | --- | --- |
| Backlog | Not picked up yet | the developer |
| Design | Design in progress with the developer, posted on the issue for review | `/unity:design` at start |
| Build | Design approved; implementation and unit tests (TDD), also rework | `/unity:design` once the developer approves the posted design in conversation; the reviewer on rejection |
| Review | PR ready, final code review | the builder when every task is done |
| Done | Merged | the board's "Item closed" workflow, when the merge closes the issue |

The developer's approval of the design is the one human gate. `/unity:design` posts the design on the issue while it stays in Design, the developer reads it there and approves the latest version in conversation, and only then does `/unity:design` move the issue to Build. The builder works only on issues in Build.

### Conventions

- **Branch:** `feature/<issue>-<slug>` (e.g. `feature/42-guest-checkout`).
- **PR body** contains `Closes #<issue>`.
- **The design lives in the issue, the plan on the PR, neither in the repository.** The latest `role:design` comment is the design. The builder writes the implementation plan when it starts, against the current main, and posts it on the PR as a `role:plan` comment; nobody approves it. This overrides any convention that commits specs or plans as files (such as `docs/specs/` and `docs/plans/`), and the file-saving steps of planning skills: post the content as the comment instead.
- **Role comments** start with a hidden marker so the next role can find them: `<!-- role:design v1 -->`, `<!-- role:plan -->`, `<!-- role:build -->`, `<!-- role:review -->`. A revised design is a new comment with a higher version; the latest one counts. The design is posted on the issue; build and review post on the PR, and each also leaves a one-line pointer on the issue (no marker), so the issue shows the whole flow.
- **Acceptance criteria** are part of the design comment, numbered and testable from the outside:

  ```markdown
  <!-- role:design v1 -->
  ## Design
  ...
  ## Acceptance criteria
  - AC1: A guest can complete checkout without creating an account
  - AC2: An invalid email address shows an inline error and blocks submission
  ```

  Every role refers to criteria by ID: tests are tagged `@AC2`, review checks that each one is met, and `/unity:test` tests them against the running system.

### Testing responsibilities

- **Build** owns unit tests, written test-first.
- **`/unity:test`** owns the integration tests, the E2E tests, or both, as chosen at `/unity:init` (`pipeline.js test-kinds` prints the choice), and never changes application code or unit tests. The builder and the reviewer leave them alone.
- **A story never waits for integration or E2E tests.** Keep them out of the checks a story's PR must pass; a story that breaks one is dealt with by the next `/unity:test`.

### Integration testing

<!-- Kept by /unity:init when the project has integration tests, removed otherwise; adjust as needed. write-system-test reads this section. -->

- Integration test directory: see `integration.dir` in `.claude/pipeline.json`
- Run every integration test: see `integration.runCommand` in `.claude/pipeline.json`
- How the tests start or call the system: `<the process, server or client they drive>`
- Test data: `<where it comes from>`

### E2E testing

<!-- Kept by /unity:init when the project has E2E tests, removed otherwise; adjust as needed. write-system-test reads this section. -->

- E2E directory: `e2e/` (fixtures in `e2e/fixtures/`, API fixture in `e2e/fixtures/api.ts`)
- Translations: `<path to messages file, or "none">`; helper: `<translation helper name>`
- UI components: `<path>`
- API layer: `<GraphQL services / REST routes path>`
- Start the app for testing: see `test.start` in `.claude/pipeline.json`
- Test users and data: `<where they come from>`
<!-- unity:workflow:end -->
