"use client";

import { useDeployment } from "@/lib/genlayer/hooks";

/** Shown only when the configured address is not a RECON deployment. */
export function DeploymentBanner() {
  const d = useDeployment();
  if (!d.data || d.data.ok) return null;
  return (
    <p role="alert" className="mb-6 border border-conflict/60 bg-charcoal px-4 py-3 text-sm">
      <span className="text-conflict">This site is not connected to RECON. </span>
      <span className="text-muted">{d.data.reason} Nothing can be sent until the configuration is fixed.</span>
    </p>
  );
}
