import { BondChip } from "@/components/recon/chips";
import type { ChainTx, Recon } from "@/lib/genlayer/recon";
import { configResult } from "@/lib/genlayer/config";
import { formatGen, formatTime, shortAddress, shortHash } from "@/lib/formatting/present";

/**
 * The bond: an economic commitment attached to the request, never evidence
 * weight. It cannot change a result, and it is refunded in full to the creator
 * when the request closes. The contract records the refund as emitted; the GEN
 * moves when the refund transaction is final on GenLayer, so "confirmed" is
 * shown only when that transaction's own status says so.
 */
export function BondPanel({ recon, refundTx, txLookup }: {
  recon: Recon;
  refundTx?: ChainTx;
  txLookup: "found" | "missing" | "loading" | "failed";
}) {
  const explorer = configResult.ok ? configResult.config.explorer : "";
  const refunded = recon.bond_status === "REFUNDED";
  const confirmed = refunded && refundTx?.status === "FINALIZED";
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Bond required">{formatGen(recon.bond_required)}</Field>
        <Field label="Held now">{formatGen(recon.bond_deposited)}</Field>
        <Field label="Status"><BondChip status={recon.bond_status} /></Field>
        <Field label="Returns to">{shortAddress(recon.creator)}</Field>
      </dl>

      {refunded ? (
        <div className="border-l-2 border-support pl-3 text-sm">
          <p>
            Refund emitted: {formatGen(recon.refunded_amount)} to the creator, recorded {formatTime(recon.refunded_at)}.
          </p>
          <p className="mt-0.5 text-muted">
            {confirmed
              ? "Refund confirmed: the refund transaction is final on GenLayer, so the transfer has been sent."
              : refundTx
                ? `The refund transaction is ${refundTx.status.toLowerCase()} on GenLayer; the GEN moves when it is final.`
                : txLookup === "loading"
                  ? "Looking up the refund transaction…"
                  : "Refund confirmation unavailable: the refund transaction could not be located on StudioNet."}
          </p>
          {refundTx ? (
            <a href={`${explorer}/tx/${refundTx.hash}`} target="_blank" rel="noreferrer"
               className="mono mt-1 inline-block text-[11px] text-muted underline underline-offset-4 hover:text-warm">
              Settlement transaction {shortHash(refundTx.hash)}
            </a>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {recon.bond_status === "LOCKED"
            ? "Held by the contract until the observation window closes. It never influences a result."
            : "Refundable now. Anyone may send the refund; it goes only to the creator."}
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="mono mt-1 text-sm">{children}</dd>
    </div>
  );
}
