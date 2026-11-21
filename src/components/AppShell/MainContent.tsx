"use client";

import { createContext, useContext, type ComponentPropsWithoutRef } from "react";

const InsideMain = createContext(false);

/** The root 404 can render on its own or inside the student layout's main landmark. */
export function MainContent({ children, ...props }: ComponentPropsWithoutRef<"main">) {
  if (useContext(InsideMain)) return <div {...props}>{children}</div>;
  return (
    <main {...props}>
      <InsideMain value={true}>{children}</InsideMain>
    </main>
  );
}
