"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section className="pane max-w-2xl" role="alert">
      <h1 className="pane-title"><span className="index">!</span>This page could not be shown</h1>
      <div className="grid gap-3 p-5 text-sm">
        <p className="text-muted">{error.message || "The page failed while reading the contract."}</p>
        <button type="button" className="btn w-fit" onClick={reset}>Try again</button>
      </div>
    </section>
  );
}
