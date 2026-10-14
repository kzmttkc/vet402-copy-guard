// The one sentence of the mandate that says when the agent may not act. agent/rules-v2.ts
// implements exactly this, and a test in agent/v2.test.ts holds the two together: every rule
// of group A, B and M that fails gives NONE, except A4 with no anchor yet, which the user's
// limits grade (reduced by default, none when the user says so).
export const MAY_NOT_ACT = "act on a move when a rule of group A, B or M fails, except rule A4 when the record has no anchor yet, in which case the user's limits grade the size down"
