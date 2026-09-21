import Link from "next/link";

export default function NotFound() {
  return (
    <section className="pane max-w-2xl">
      <h1 className="pane-title"><span className="index">404</span>Nothing here</h1>
      <div className="grid gap-3 p-5 text-sm text-muted">
        <p>This address does not name a page of RECON.</p>
        <Link href="/dashboard" className="w-fit text-warm underline underline-offset-4">Go to the dashboard</Link>
      </div>
    </section>
  );
}
