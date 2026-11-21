"use client";

import Image from "next/image";
import { useState } from "react";
import { useT } from "@/i18n/client";

export function PoliQuestionsPreview() {
  const t = useT().landing.ask;
  const [selected, setSelected] = useState(0);
  return (
    <section className="welcome-ask" aria-labelledby="ask-heading">
      <h2 id="ask-heading">{t.heading} <em>{t.accent}</em></h2>
      <div role="group" aria-labelledby="ask-heading" className="ask-options">
        {t.prompts.map((prompt, i) => <button key={prompt.question} type="button" aria-pressed={i === selected} onClick={() => setSelected(i)}>{prompt.question}</button>)}
      </div>
      <div className="sample-reply">
        <Image src="/images/mascot.svg" width={48} height={48} alt="" />
        <div>
          <p className="text-xs font-semibold text-brand-700">{t.example}</p>
          <p className="reply-bubble" aria-live="polite" aria-atomic="true">{t.prompts[selected].answer}</p>
        </div>
      </div>
    </section>
  );
}
