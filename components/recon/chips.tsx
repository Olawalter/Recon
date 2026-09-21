import type { BondStatus, EvidenceStatus, Freshness, ReconciliationStatus, RequestStatus } from "@/lib/genlayer/recon";
import { BOND_STATUS, EVIDENCE, FRESHNESS, RECONCILIATION, REQUEST_STATUS } from "@/lib/formatting/present";

/**
 * Small labelled marks. Every one carries its meaning as words; colour only
 * repeats it. Supports and conflicts have reserved colours; amber marks what
 * needs attention; everything else is quiet.
 */

const base = "mono inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider";

export function ReconciliationChip({ status }: { status: ReconciliationStatus }) {
  const tone = status === "RESOLVED" ? "border-support/60 text-support" : "border-amber/60 text-amber";
  return <span className={`${base} ${tone}`} title={RECONCILIATION[status].meaning}>{RECONCILIATION[status].label}</span>;
}

export function EvidenceChip({ status }: { status: EvidenceStatus }) {
  const tone = status === "SUPPORTING" ? "border-support/60 text-support"
    : status === "CONFLICTING" ? "border-conflict/60 text-conflict"
      : "border-edge text-muted";
  return <span className={`${base} ${tone}`} title={EVIDENCE[status].meaning}>{EVIDENCE[status].label}</span>;
}

export function FreshnessChip({ freshness }: { freshness: Freshness }) {
  const tone = freshness === "CURRENT" ? "border-edge text-warm" : freshness === "CONFLICTING" ? "border-amber/60 text-amber"
    : "border-edge text-muted";
  return <span className={`${base} ${tone}`} title={FRESHNESS[freshness].meaning}>{FRESHNESS[freshness].label}</span>;
}

export function StatusChip({ status }: { status: RequestStatus }) {
  const tone = status === "PROPOSED" ? "border-amber/60 text-amber" : "border-edge text-muted";
  return <span className={`${base} ${tone}`}>{REQUEST_STATUS[status]}</span>;
}

export function BondChip({ status }: { status: BondStatus }) {
  const tone = status === "REFUNDABLE" ? "border-amber/60 text-amber" : "border-edge text-muted";
  return <span className={`${base} ${tone}`}>Bond: {BOND_STATUS[status].toLowerCase()}</span>;
}
