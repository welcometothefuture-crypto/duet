/**
 * Collaboration modes. Each mode decides, given the run state, whose turn it is,
 * what prompt that agent receives, and whether the collaboration is finished.
 *
 * A "turn" record looks like: { n, agent, prompt, output, ts }.
 * run.scratch is a free-form per-run object modes can use to track phase, etc.
 *
 * Sentinels an agent can emit in its final message:
 *   [[DONE]]      - the whole task is complete (peers / manager)
 *   [[APPROVED]]  - reviewer signs off (builder+reviewer)
 */

const NAMES = { claude: 'Claude', codex: 'Codex' };

function other(agent) {
  return agent === 'claude' ? 'codex' : 'claude';
}

function lastFrom(run, agent) {
  for (let i = run.turns.length - 1; i >= 0; i--) {
    if (run.turns[i].agent === agent) return run.turns[i];
  }
  return null;
}

function hasSentinel(turn, token) {
  return !!turn && typeof turn.output === 'string' && turn.output.includes(token);
}

// Shared protocol text every agent sees, so the two coordinate through files + handoff notes.
function protocol(run, agent) {
  const me = NAMES[agent];
  const peer = NAMES[other(agent)];
  return [
    `You are ${me}, collaborating with ${peer} on a shared project in the current directory.`,
    `You are BOTH autonomous agents working toward the same goal — work concretely: create and edit real files, run commands, and verify your work.`,
    ``,
    `Coordination protocol:`,
    `- A shared file COLLAB.md is your shared whiteboard. Read it at the start of your turn to see ${peer}'s notes and the current state.`,
    `- At the END of your turn, append a short dated section to COLLAB.md titled "## ${me} — <what you did>" summarizing what you changed, what works, and a clear handoff: what ${peer} should do next.`,
    `- Do not undo ${peer}'s work without explaining why in COLLAB.md.`,
    `- Keep momentum: finish a coherent, working increment each turn rather than restating plans.`,
  ].join('\n');
}

function injectedNotes(run) {
  if (!run.pendingInjects || run.pendingInjects.length === 0) return '';
  const notes = run.pendingInjects.join('\n');
  run.pendingInjects = [];
  return `\n\nHUMAN OPERATOR NOTE (high priority, follow this):\n${notes}\n`;
}

function peerHandoff(run, agent) {
  const peerTurn = lastFrom(run, other(agent));
  if (!peerTurn) return '';
  return `\n\n${NAMES[other(agent)]}'s latest handoff message:\n"""\n${peerTurn.output || '(no message)'}\n"""\n`;
}

export const MODES = {
  // ---------------------------------------------------------------- Peers
  peers: {
    id: 'peers',
    label: 'Peers (turn-taking)',
    description:
      'Both agents alternate as equal pair-programmers, each building on the other’s work until the task is done.',
    roleFields: [
      { key: 'first', label: 'Goes first', type: 'agent', default: 'claude' },
    ],
    firstAgent: (run) => run.roles.first || 'claude',
    nextAgent: (run, last) => other(last),
    isDone: (run, lastTurn) =>
      hasSentinel(lastTurn, '[[DONE]]') || run.turns.length >= run.maxRounds,
    buildPrompt(run, agent) {
      const first = run.turns.length === 0;
      return [
        protocol(run, agent),
        ``,
        `THE TASK:\n${run.task}`,
        first
          ? `\nYou are starting. Kick off the project: set up structure and implement a first working slice, then hand off.`
          : `\nContinue the project. Build the next meaningful increment, then hand off.`,
        `\nWhen you are confident the ENTIRE task is complete and verified, include the token [[DONE]] in your final message.`,
        peerHandoff(run, agent),
        injectedNotes(run),
      ].join('\n');
    },
  },

  // -------------------------------------------------- Builder + Reviewer
  builder_reviewer: {
    id: 'builder_reviewer',
    label: 'Builder + Reviewer',
    description:
      'One agent implements; the other reviews, tests, and returns feedback. Loops until the reviewer approves.',
    roleFields: [
      { key: 'builder', label: 'Builder', type: 'agent', default: 'claude' },
    ],
    firstAgent: (run) => run.roles.builder || 'claude',
    nextAgent: (run, last) => other(last),
    isDone: (run, lastTurn) => {
      const reviewer = other(run.roles.builder || 'claude');
      return (
        (lastTurn?.agent === reviewer && hasSentinel(lastTurn, '[[APPROVED]]')) ||
        run.turns.length >= run.maxRounds
      );
    },
    buildPrompt(run, agent) {
      const builder = run.roles.builder || 'claude';
      const isBuilder = agent === builder;
      const first = run.turns.length === 0;
      const head = [protocol(run, agent), ``, `THE TASK:\n${run.task}`, ``];
      if (isBuilder) {
        head.push(
          `Your ROLE: BUILDER. Implement the work in real files.`,
          first
            ? `Start building: create the project and a first working implementation.`
            : `Address the reviewer's feedback below and improve the implementation.`,
        );
      } else {
        head.push(
          `Your ROLE: REVIEWER. Do NOT rewrite the whole thing. Read the builder's code, actually run/test it, and write precise, actionable feedback (bugs, gaps, style). You may make small fixes.`,
          `If — and only if — the implementation fully satisfies the task and you have verified it works, include the token [[APPROVED]] in your final message.`,
        );
      }
      return [...head, peerHandoff(run, agent), injectedNotes(run)].join('\n');
    },
  },

  // -------------------------------------------------- Manager + Workers
  manager_workers: {
    id: 'manager_workers',
    label: 'Manager + Workers',
    description:
      'One agent breaks the task into a checklist; both agents then take items in turn until everything is checked off.',
    roleFields: [
      { key: 'manager', label: 'Manager', type: 'agent', default: 'claude' },
    ],
    firstAgent: (run) => run.roles.manager || 'claude',
    nextAgent: (run, last) => other(last),
    isDone: (run, lastTurn) =>
      hasSentinel(lastTurn, '[[DONE]]') || run.turns.length >= run.maxRounds,
    buildPrompt(run, agent) {
      const manager = run.roles.manager || 'claude';
      const isManagerOpening = run.turns.length === 0 && agent === manager;
      const head = [protocol(run, agent), ``, `THE TASK:\n${run.task}`, ``];
      if (isManagerOpening) {
        head.push(
          `Your ROLE this turn: MANAGER / PLANNER. Decompose the task into a concrete, ordered checklist of work items and write it into COLLAB.md as a markdown task list ("- [ ] item"). Optionally start the first item. Then hand off.`,
        );
      } else {
        head.push(
          `Pick the NEXT unchecked item(s) from the COLLAB.md checklist that you can do now, implement them in real files, verify, and mark them "- [x]" in COLLAB.md. Update the checklist if you discover new work.`,
          `When EVERY item is checked and the task is verified end-to-end, include the token [[DONE]] in your final message.`,
        );
      }
      return [...head, peerHandoff(run, agent), injectedNotes(run)].join('\n');
    },
  },

  // ----------------------------------------------------- Debate → build
  debate: {
    id: 'debate',
    label: 'Debate → consensus',
    description:
      'Both agents argue approaches for a few rounds, converge on a plan, then split the work and implement it.',
    roleFields: [
      { key: 'first', label: 'Opens debate', type: 'agent', default: 'claude' },
      { key: 'debateRounds', label: 'Debate rounds', type: 'number', default: 2 },
    ],
    firstAgent: (run) => run.roles.first || 'claude',
    nextAgent: (run, last) => other(last),
    isDone: (run, lastTurn) =>
      hasSentinel(lastTurn, '[[DONE]]') || run.turns.length >= run.maxRounds,
    buildPrompt(run, agent) {
      const debateTurns = (Number(run.roles.debateRounds) || 2) * 2; // each round = both speak
      const inDebate = run.turns.length < debateTurns;
      const head = [protocol(run, agent), ``, `THE TASK:\n${run.task}`, ``];
      if (inDebate) {
        head.push(
          `PHASE: DEBATE (no implementation yet). Propose your approach and architecture for this task. Critique the trade-offs in ${NAMES[other(agent)]}'s proposal below. Move toward a shared decision. Record the evolving agreed plan in COLLAB.md under "## Agreed Plan".`,
        );
      } else {
        const justEntered = run.turns.length === debateTurns;
        head.push(
          `PHASE: BUILD. The debate is over — follow the "## Agreed Plan" in COLLAB.md.`,
          justEntered
            ? `Begin implementation of your share of the agreed plan in real files, then hand off.`
            : `Continue implementing the agreed plan, building on ${NAMES[other(agent)]}'s work.`,
          `When the whole task is implemented and verified, include the token [[DONE]] in your final message.`,
        );
      }
      return [...head, peerHandoff(run, agent), injectedNotes(run)].join('\n');
    },
  },
};

export function listModes() {
  return Object.values(MODES).map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description,
    roleFields: m.roleFields,
  }));
}
