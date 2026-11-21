"use client";

import { askAssistant } from "./Mascot";

/** A button that sends a question to Poli and opens the chat. */
export function AskPoli({ question, children, className = "btn-secondary" }: { question: string; children?: React.ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => askAssistant(question)}>
      {children ?? <>💬 {question}</>}
    </button>
  );
}
