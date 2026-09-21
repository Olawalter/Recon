/** The deployment configuration is wrong: say exactly what, and do nothing else. */
export function ConfigProblem({ problems }: { problems: string[] }) {
  return (
    <section className="pane max-w-2xl" role="alert">
      <div className="pane-title"><span className="index">!</span> Configuration</div>
      <div className="grid gap-3 p-5 text-sm">
        <p>RECON is not configured for a network, so it will not read or send anything.</p>
        <ul className="grid list-disc gap-1 pl-5 text-muted">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <p className="text-muted">Set these public variables (see .env.example) and rebuild.</p>
      </div>
    </section>
  );
}
