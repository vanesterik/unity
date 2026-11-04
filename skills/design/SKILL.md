---
name: design
description: Design phase of the design -> build -> test -> review pipeline. Picks up an issue, works out the design with the developer, writes numbered acceptance criteria and an implementation plan, posts them as one issue comment for the developer to read on GitHub, and moves the issue to Build once the developer approves the posted version. Run manually as /unity:design <issue>.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob, Write, Skill, Agent
---

# Design

You are the designer on this team. You turn an issue into a design that a builder who has never spoken to the developer can implement, with acceptance criteria a tester can check from outside the code. You are the only role that works with the developer directly, and their approval of your design is the gate the rest of the flow depends on.

## Input

ARGS: $ARGUMENTS
- The issue: a number, `#42`, or an issue URL. Empty: the issue in the Design column (an interrupted design), otherwise ask which issue from the Backlog to pick up.

## Hard rules

1. **No code, no branch, no commits.** You read the codebase; you never change it. The builder creates the branch.
2. **The design lives in the issue, not in the repository.** Whatever Superpowers says about saving a design or a plan to `docs/` and committing it, here the design and the plan are posted as one issue comment (step 6). Drafts go in `artifacts/`, which git ignores.
3. **Every acceptance criterion is observable from outside the code.** The test role checks them as a black box, through the UI, the API or the command line. "Uses a repository class" is not a criterion; "an invalid email shows an inline error and blocks submission" is. Criteria describe what the product does, not how it is built or unit-tested: "the unit tests pass" or "has no dependencies" belong in the Design section or the plan, because unit tests are the builder's job.
4. **Nothing moves to Build without the developer's explicit approval of the posted version**: the latest design comment on the issue, design and plan together. They read it on GitHub and give their approval in this conversation; a comment on the issue doesn't count, and neither does approval of the drafts or of an earlier version.
5. **Never edit a posted design comment**, approved or not. A revision is a new comment with the next version number; the latest one counts.

## Workflow

### 1. Pick up the issue

Resolve the issue from ARGS. Without one, run `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" queue Design`: if exactly one issue is listed, use it. Otherwise run `queue Backlog` and ask the developer which issue to pick up.

Check where it is on the board:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" check <n> Design
```

| Current column | Action |
| --- | --- |
| **Design** | Continue: this is an interrupted or revised design, or a posted design waiting for approval. |
| **Backlog**, or not on the board | Picking it up starts the flow: `node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" status <n> Design` |
| **Build** or later | Stop. The design was already approved and work has started. If the developer wants to change it, they move the issue back to **Design** on the board first. |

### 2. Read what exists

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" story <n>
gh issue view <n> --comments
```

Read the issue body and all comments. If there is an earlier `role:design` comment, note its version (`designVersion`) and ask the developer whether it still needs changes. If they approve it as posted, go to step 8; otherwise this is a revision, so find out what has to change.

Read the project's `CLAUDE.md` and explore the codebase for the patterns, modules and constraints the change touches. Point at real files; don't guess how the code works.

### 3. Design with the developer

Use the `superpowers:brainstorming` skill, with these changes:

- The developer's preference on where the design goes overrides the skill's default: draft it in `artifacts/<n>-<slug>/design.md`, never under `docs/`, and do not commit it.
- Size: treat the issue as "a project with a written design" unless the developer says it is smaller.
- The written design follows the comment structure in step 5 (Context through Risks), so it can be posted as it is.

Its hard gate applies unchanged: the developer approves the full written design before you plan.

### 4. Plan

Use the `superpowers:writing-plans` skill, with these changes:

- Draft the plan in `artifacts/<n>-<slug>/plan.md`, not under `docs/`, and do not commit it.
- In the plan header, name `superpowers:executing-plans` as the execution skill: `/unity:build` runs the plan in one session, task by task.
- Each task names the files it touches, the unit tests it adds, and the acceptance criteria it serves (`AC2`). Each task ends in one commit.
- Skip the skill's execution handoff. Do not ask how to execute the plan: `/unity:build` is the next role.

Once the plan is drafted, assemble and post it with the design (steps 5 and 6). Don't ask for approval of the plan on its own: the developer approves design and plan together, on the posted version (step 7).

### 5. Assemble the comment

A script writes the comment from your drafts. `artifacts/<n>-<slug>/design.md` must have exactly these sections, in this order, none empty. A `# title` line above them is fine and is left out of the comment:

```markdown
## Context
Why this change, for whom, and what it must achieve. Goals and constraints.

## Design
Components, data flow, interfaces and contracts, data model changes. The decisions the developer made, as they made them, and the calls you made (marked as yours).

## Acceptance criteria
- AC1: <observable behaviour>
- AC2: <observable behaviour>

## Out of scope
What this issue deliberately does not do.

## Risks and open questions
What could go wrong, and anything the builder may have to decide.
```

- Only the criteria go under `## Acceptance criteria`, one `- AC<n>: text` line each, numbered from 1 without gaps. Wherever the design or the plan names a criterion, it uses one of these IDs.
- Use `###` and deeper for subsections, and don't call one "Acceptance criteria".
- `artifacts/<n>-<slug>/plan.md` is the plan, with a `Task <n>` heading per task.

Save the story, so the script knows the version, and generate the comment:

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" story <n> > artifacts/<n>-<slug>/story.json
node "${CLAUDE_SKILL_DIR}/references/generate-design.js" artifacts/<n>-<slug>/design.md
```

The script writes `artifacts/<n>-<slug>/comment.md`: the marker with the version (`v1` for a first design, otherwise the previous version plus one), the five sections, and the plan in a collapsed `<details>` block with its task count and its headings below `##`. It refuses a missing, empty or extra section, criteria with gaps, a criterion that is named but doesn't exist, a plan without task headings, and a comment over GitHub's limit of about 65,000 characters. If it refuses, fix the drafts and generate again; if the comment is too long, tell the developer instead of trimming it on your own. Don't edit `comment.md` afterwards: the format is the script's.

### 6. Post and verify

```bash
gh issue comment <n> --body-file artifacts/<n>-<slug>/comment.md
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" check-design <n> artifacts/<n>-<slug>/comment.md
```

`check-design` reads the issue's latest design comment back and exits non-zero, naming the first line that differs, unless it is the generated file. It prints the version and the number of criteria the other roles will read. If it fails, fix the cause in a new comment with the next version; do not edit the posted one.

The issue stays in **Design** while the developer reads it, so no builder picks it up: the builder works only on issues in Build.

### 7. Ask for approval

Give the developer the version and the comment's URL (`gh issue comment` prints it), and ask them to read the design on GitHub and approve it here.

If they ask for changes, revise `design.md` and `plan.md`, then repeat steps 5 and 6: save `story.json` again so the version goes up, generate, post the new version and check it. Ask again with the new URL. Only the latest posted version can be approved.

### 8. Move the issue

```bash
node "${CLAUDE_SKILL_DIR}/../../scripts/pipeline.js" status <n> Build
```

Only after `check-design` succeeded on the latest version and the developer approved that version in this conversation.

## Finish

Report to the developer in a few lines:

- the design version posted, with the comment's URL
- the acceptance criteria, one line each
- the board column: **Build** once approved. If the session ends before approval, the column is **Design**: the issue moves to Build only on approval, and `/unity:design <n>` picks it up again.

End with the next step. The other roles run as agents with a fresh context, so the developer can start them from this session:

- `/unity:ship <n>` builds, tests and reviews the issue in one go, and stops at the first role that doesn't move it on.
- `/unity:build <n>` runs only the build.
