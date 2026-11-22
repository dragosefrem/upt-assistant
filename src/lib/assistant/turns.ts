/**
 * The turns the assistant is answering right now, by student. A turn goes on when the page is
 * reloaded or closed, so the conversation needs to know one is still under way: a second
 * question is not started on top of it, and "still writing" is shown only while it is true.
 * Kept in this process, like the answer being written.
 */
const state = globalThis as typeof globalThis & { __assistantTurns?: Map<string, number> };
const turns = (state.__assistantTurns ??= new Map<string, number>());

/** The question (its message id) being answered for this student, if any. */
export function runningTurn(userId: string): number | null {
  return turns.get(userId) ?? null;
}

export function beginTurn(userId: string, messageId: number) {
  turns.set(userId, messageId);
}

export function endTurn(userId: string, messageId: number) {
  if (turns.get(userId) === messageId) turns.delete(userId);
}
