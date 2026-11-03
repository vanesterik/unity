![Unity](./unity.webp)

# Unity

**Unity** is a [Claude Code](https://claude.com/claude-code) plugin for a role-based development flow on GitHub: **design → build → test → review**. Design is a conversation with you; build, test and review each run as their own agent with a fresh context, one after the other, from a single command. The GitHub issue, its pull request and a Project board are the only handoff between them.

## Motivation

One agent that designs, builds, tests and reviews its own work in a single conversation grades its own homework. Its context fills up with its own reasoning, and the further a session runs, the less that reasoning is questioned. Unity splits the work into four agents that don't share a context and don't take each other's word for it: the designer agrees the design and testable acceptance criteria with you, the builder implements them test-first, the tester checks the running system against the criteria as a black box, and the reviewer reads the result as someone who has to maintain it next year.

The workflow around them is deterministic. Every role reads the same inputs from GitHub, checks the board before it starts, and hands over through a fixed format: verdicts, coverage and counts are computed by scripts, not written by the agent. That is what makes the output scale. Each story arrives as one pull request with one commit per task, mapped to its acceptance criteria, tested from the outside and reviewed line by line, whether it is the first story in a project or the hundredth.

## Name

The name **Unity** is a wink to Unity, the hive mind from the Rick and Morty episode [Auto Erotic Assimilation](https://en.wikipedia.org/wiki/Auto_Erotic_Assimilation), who assimilates a whole planet into one perfectly coordinated mind. It fits: like Unity, this plugin makes almost anything possible, as long as you align to the workflow.

## Install

Unity builds on these, which it doesn't install itself:

- [Superpowers](https://github.com/obra/superpowers), for brainstorming, plans, test-driven development, verification and code review: `/plugin install superpowers@claude-plugins-official`
- [GitHub CLI](https://cli.github.com) (`gh`) with access to Projects: `gh auth refresh -s project`
- Node
- for web projects: Playwright and the `playwright-cli` skill

The repository is its own marketplace.

**First time on a machine**, install it at user level, so `/unity:init` is available before a project is set up:

```
/plugin marketplace add vanesterik/unity
/plugin install unity@unity
```

**Per project**, run `/unity:init` once (see [Usage](#usage)). It adds this to the project's `.claude/settings.json`, so the plugin is enabled for that repository and stays up to date:

```json
{
  "extraKnownMarketplaces": {
    "unity": { "source": { "source": "github", "repo": "vanesterik/unity" }, "autoUpdate": true }
  },
  "enabledPlugins": { "unity@unity": true }
}
```

## Usage

1. **Set up the project.** Create a GitHub Project with a **Status** field whose options are exactly `Backlog`, `Design`, `Build`, `Test`, `Review` and `Done`. Then, in Claude Code in the repository:

   ```
   /unity:init <owner> <project-number>
   ```

   It writes `.claude/pipeline.json` with the board's IDs and the project's start and test commands, adds a workflow section to `CLAUDE.md` and `artifacts/` to `.gitignore`, and enables the plugin. It asks you to confirm what it detected, and suggests the commit to make.

2. **Let the board move merged issues to Done.** This is the only move no role makes, and GitHub's API can't configure it, so you set it once by hand. It works in two links: the pull request that the builder opens has `Closes #<issue>` in its body, so merging it into `main` closes the issue; the board's **Item closed** workflow then sets a closed issue's Status to **Done**. To turn the workflow on:

   1. Open the project board on GitHub and choose **⋯** (top right) > **Workflows**.
   2. Select **Item closed** in the list of default workflows.
   3. Choose **Edit**. Under **When**, keep the filter on issues (`is:issue`, or `is:issue,pr`).
   4. Under **Set**, choose the **Status** field and the value **Done**.
   5. Choose **Save and turn on workflow**. The list now shows it as on.

   `Closes` only works for pull requests into the repository's default branch, so `main` must be the default. `/unity:init` warns when it finds the workflow off.

3. **Write the issue.** A user story as a GitHub issue, added to the board in **Backlog**.

4. **Design it with Claude:**

   ```
   /unity:design <issue>
   ```

   This is the one role you work with. It moves the issue to **Design**, reads the codebase, and works out the design with you, with numbered acceptance criteria (`AC1`, `AC2`, ...) that can be checked from outside the code. Then it writes an implementation plan, one commit per task. You approve the design and then the plan: that approval is the one human gate in the flow. A script assembles both into one comment, checking the sections and the numbering of the criteria; it is posted on the issue, read back to check it arrived unchanged, and the issue moves to **Build**.

5. **Ship it**, from the same session:

   ```
   /unity:ship <issue>
   ```

   This runs the other three roles one after the other, each as its own agent with a fresh context, so none of them sees your design conversation or another role's reasoning. After each agent, it reads the board and goes on only if the issue moved to the next column. You watch nothing in between. At the end it prints one line per role with its result and link, then the column and the next step, written by a script from what the roles posted on GitHub.

   - **The builder** (`unity:builder`) creates `feature/<issue>-<slug>`, implements the plan task by task with unit tests written first, and pushes each task as its own commit to a draft pull request. A script writes the pull request body from the builder's data, with a table that maps every criterion of the design to its code and unit tests. When every task is done, it marks the pull request ready and moves the issue to **Test**.
   - **The tester** (`unity:tester`) tests the running system against the acceptance criteria as a black box, codifies the cases as integration or E2E tests on the branch, and posts a report on the pull request. On a pass it moves the issue to **Review**; on a failure, back to **Build**. A criterion it couldn't test leaves the issue in **Test**.

     The tester may only write tests, never application code or unit tests, so a failure goes back to the builder instead of being fixed in place. A hook enforces this: the tester writes `artifacts/.test-active` when a run starts and removes it at the end, and while that file exists, edits outside `test.writablePaths` in `.claude/pipeline.json` are blocked. Outside a test run the hook does nothing. If a run is interrupted, the file stays behind and the builder stops until you delete it.
   - **The reviewer** (`unity:reviewer`) reviews the whole pull request against the design, runs the tests itself, and posts a verdict. Blocking findings send the issue back to **Build**. An approval leaves it in **Review**, ready for you.

6. **If it stops early**, its report says why, with the stopping role's report below it:

   - **A failed test or blocking findings** put the issue back in **Build**. Run `/unity:ship <issue>` again: the builder reworks the findings, and test and review run again. Each role runs at most once per `/unity:ship`, so a rework never loops on its own.
   - **An untested criterion** leaves the issue in **Test** for you to decide: test it another way, accept the gap, or send it back to `/unity:design`.
   - **A role that stopped** before its work (a leftover test marker, a design without criteria) says what it needs.

   To run a single role instead, use `/unity:build`, `/unity:test` or `/unity:review`. Each starts its agent the same way, and `/unity:ship` picks up from whatever column the issue is in.

7. **Merge.** Review the pull request commit by commit and merge it with a rebase, so each task stays its own commit on `main`. The `Closes #<issue>` line closes the issue, and the "Item closed" workflow moves it to **Done**. If GitHub doesn't close the issue, close it by hand with a comment on how each criterion was met.

The agents can't ask you anything mid-run: where a role needs a decision, it stops and hands back. Each role also checks the board first, so a role started on an issue in the wrong column stops. Along the way the issue collects a one-line pointer to each role's result, written by a script from what the role posted, so it reads as a timeline of the story. To see where every issue stands and what to run next, without opening GitHub, run `/unity:status`.

## Board

The board's **Status** field is the workflow state, and each role is named after the column it works in. Design runs in your session; the three roles inside the box run as agents, started by `/unity:ship`. It follows the solid arrows and stops at a dashed one:

```mermaid
flowchart TB
    Backlog["<b>Backlog</b><br/>not picked up yet"]
    Design["<b>Design</b><br/>design and plan, with you"]
    Done["<b>Done</b><br/>merged"]

    subgraph ship ["/unity:ship: one agent per role, each with a fresh context"]
        Build["<b>Build</b><br/>implementation or rework"]
        Test["<b>Test</b><br/>black-box testing"]
        Review["<b>Review</b><br/>final code review"]
    end

    Backlog -->|"/unity:design picks it up"| Design
    Design -->|"/unity:design on your approval"| Build
    Build -->|"every task done"| Test
    Test -->|"pass"| Review
    Test -.->|"failure"| Build
    Review -.->|"blocking findings"| Build
    Review -->|"you merge; Item closed workflow"| Done
```

You add new issues to **Backlog**. A criterion the tester couldn't test leaves the issue in **Test** for you to decide.

Designs and plans live in the issue, as the latest `role:design` comment, not as files in the repository. Build, test and review post on the pull request. Each role output starts with a hidden marker (`<!-- role:test -->`), so the next role finds the latest one.

## Commands

`/unity:init` sets up a project once. `/unity:design` and `/unity:ship` run the workflow, `/unity:status` shows where every issue stands, the three role commands run one role each as its agent, and the last three are the skills the roles build on, which you can also run on their own.

| Command | What it does |
| --- | --- |
| `/unity:init <owner> <project>` | Sets up a repository: `.claude/pipeline.json` with the board IDs and the detected start and test commands, the `CLAUDE.md` workflow section, `.gitignore`, plugin settings |
| `/unity:design <issue>` | Works out the design, acceptance criteria and plan with you, posts them as one issue comment, and moves the issue to Build on your approval |
| `/unity:ship <issue>` | Runs the builder, tester and reviewer agents one after the other, from the issue's current column, as long as each one moves it on |
| `/unity:status` | Shows every issue on the board per column, with its pull request, latest result and next command, and warns about what the columns don't show; changes nothing |
| `/unity:build <issue>` | Runs the builder agent: implements the approved plan task by task with test-first unit tests, opens a pull request that maps each criterion to code and tests, and moves the issue to Test; also reworks test and review findings |
| `/unity:test <issue>` | Runs the tester agent: tests against the acceptance criteria as a black box, writes integration or E2E tests, posts the report on the pull request, and moves the issue to Review or back to Build |
| `/unity:review <issue or PR>` | Runs the reviewer agent: reviews the whole pull request against the design and criteria, posts a verdict with blocking findings and suggestions, and sends the issue back to Build or leaves it ready to merge |
| `/unity:test-user-story <issue or story>` | Exploratory testing with an evidence report, used by the tester; also usable on its own |
| `/unity:write-e2e-test` | Writes and stabilizes scripted E2E or integration tests, used by the tester; also usable on its own |
| `/unity:get-user-story <issue>` | The issue, its latest design and its acceptance criteria, as the other skills use them |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Credits

The test role stands on the work of [Tim Lolkema](https://github.com/tlolkema), who built and wrote about agentic testing with agent skills. Unity builds on his code and texts with his consent. Thanks, Tim, for sharing them so generously. ❤️

- `test-user-story`, from [tlolkema/demo-webshop](https://github.com/tlolkema/demo-webshop): deriving test cases from a user story, executing them with `playwright-cli`, and the rules for framing screenshot and video evidence. Unity adds criterion IDs on every case, retrying a failure before recording it, a pipeline mode without questions, and command-line checks.
- The test report, from the same repository: the HTML template and the generator that fills it from the run's data. Unity adds the acceptance-criteria coverage table, a verdict computed by the generator instead of supplied by the agent, and the markdown summary posted on the pull request. The review, build and design generators follow the same pattern.
- `write-e2e-test`, from [tlolkema/skills-explained](https://github.com/tlolkema/skills-explained): turning an executed case into a scripted Playwright test and repeating it until it is stable. Unity moves the project-specific paths into `CLAUDE.md` and `.claude/pipeline.json`, so it works across repositories, adds integration tests, and reports a test that stays flaky instead of hiding it.
- `get-user-story`, from demo-webshop, rewritten to read the issue, its design comment and its acceptance criteria from GitHub.

His articles explain the thinking behind it: [Using agent skills to write Playwright tests](https://tlolkema.substack.com/p/using-agent-skills-to-write-playwright) and [Why you should start using agentic testing](https://tlolkema.substack.com/p/why-you-should-start-using-agentic).
