import type { ReactNode } from "react";

/** A terminal pane: a hairline box with a numbered monospace title strip. */
export function Pane({ index, title, aside, children }: { index: string; title: string; aside?: string; children: ReactNode }) {
  const id = `pane-${index}`;
  return (
    <section className="pane min-w-0" aria-labelledby={id}>
      <h2 id={id} className="pane-title">
        <span className="index">{index}</span>
        <span>{title}</span>
        {aside ? <span className="ml-auto normal-case tracking-normal">{aside}</span> : null}
      </h2>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
