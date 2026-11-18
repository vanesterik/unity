// Reads the builder's plan.md: its headings outside code blocks, its tasks, and the criteria each task serves.
// Shared by generate-plan.js (which checks and posts the plan) and generate-build.js (which maps every
// criterion to the commits of the tasks that serve it, one commit per task).

// Lines with whether each one sits inside a fenced code block (the fence lines themselves count as inside).
const withFences = (text) => {
  let inside = false;
  return text.split('\n').map((line) => {
    const fence = /^\s*(```|~~~)/.test(line);
    const entry = { line, code: inside || fence };
    if (fence) inside = !inside;
    return entry;
  });
};

const heading = ({ line, code }) => (code ? null : line.match(/^(#{1,6})\s+(.*?)\s*$/));
const isTask = (match) => Boolean(match && /^Task\s+\d+\b/.test(match[2]));

// Another story's criterion, written with its issue ("#15 AC7", "#9 AC5 and AC6"), is not one of this
// design's, so it is taken out before the plan's own criteria are read.
const ownMentions = (text) => text.replace(/#\d+(?:'s)?\s+@?AC\d+(?:(?:\s*,\s*|\s*,?\s+and\s+)@?AC\d+)*/g, '');

// The plan's tasks in order, each with the criteria of this design it mentions (AC2, ...), in their order.
// A task runs from its heading to the next heading at its own level or above.
const planTasks = (text) => {
  const tasks = [];
  let current = null;
  for (const entry of withFences(text)) {
    const match = heading(entry);
    if (isTask(match)) {
      current = { title: match[2], level: match[1].length, lines: [match[2]] };
      tasks.push(current);
    } else if (match && current && match[1].length <= current.level) {
      current = null;
    } else if (current) {
      current.lines.push(entry.line);
    }
  }
  return tasks.map(({ title, lines }) => {
    const ids = [...ownMentions(lines.join('\n')).matchAll(/\bAC(\d+)\b/g)].map((m) => `AC${Number(m[1])}`);
    return { title, criteria: [...new Set(ids)] };
  });
};

module.exports = { withFences, heading, isTask, ownMentions, planTasks };
