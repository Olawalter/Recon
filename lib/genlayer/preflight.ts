import type { DeploymentCheck } from "@/lib/genlayer/recon";
import type { FailureKind } from "@/lib/genlayer/tx";

/**
 * What must be true before the app asks a wallet to sign anything: a wallet is
 * connected, it is on the configured network, and the configured address has
 * been verified as RECON. Each refusal is precise, so the person knows what to
 * change. Returns null when a write may be sent.
 */
export type WalletFacts = { status: "disconnected" | "connecting" | "connected"; account?: string; chainId?: number;
  hasProvider: boolean };

export function preflight(w: WalletFacts, wantChain: number, deployment?: DeploymentCheck):
  { message: string; kind: FailureKind } | null {
  if (w.status !== "connected" || !w.account || !w.hasProvider) {
    return { message: "Connect a wallet first.", kind: "TRANSACTION_FAILED" };
  }
  if (w.chainId !== wantChain) {
    return { message: "Your wallet is on another network. Switch it to GenLayer StudioNet and try again.", kind: "NETWORK_MISMATCH" };
  }
  if (deployment && !deployment.ok) {
    return { message: "The configured contract is not verified as RECON, so nothing was sent.", kind: "INVALID_REQUEST" };
  }
  return null;
}
