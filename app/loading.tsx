export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-64 max-w-full animate-pulse bg-slate" />
      <div className="h-4 w-96 max-w-full animate-pulse bg-slate" />
      <div className="mt-4 h-48 animate-pulse bg-charcoal" />
    </div>
  );
}
