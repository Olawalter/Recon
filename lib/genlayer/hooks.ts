"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readClient, writeClient, type GenLayerClient } from "@/lib/genlayer/client";
import { configResult, type AppConfig } from "@/lib/genlayer/config";
import { contractTransactions, reads, validateDeployment, type Call, type ChainTx, type DeploymentCheck, type Page,
  type ProtocolInfo, type Recon, type ReconResult, type Transition } from "@/lib/genlayer/recon";
import { preflight } from "@/lib/genlayer/preflight";
import { initialTx, runWrite, type TxState } from "@/lib/genlayer/tx";
import { useWallet } from "@/lib/wallet/wallet";

/** The configuration and a read-only client, built once. */
export function useRecon(): { config: AppConfig; client: GenLayerClient } {
  return useMemo(() => {
    if (!configResult.ok) throw new Error("RECON is not configured");
    return { config: configResult.config, client: readClient(configResult.config) };
  }, []);
}

export type Query<T> = { data?: T; error?: Error; loading: boolean; reload: () => void };

type ReadState<T> = { key: string; data?: T; error?: Error };

/**
 * A read with its own loading and error states, so a page can say which of
 * "nothing yet" and "the read failed" is true. Loading is derived from whether
 * a result for the current key has arrived, so nothing sets state during
 * render or synchronously inside the effect.
 */
export function useRead<T>(key: string, run: (c: GenLayerClient, cfg: AppConfig) => Promise<T>,
                           options: { enabled?: boolean; pollMs?: number } = {}): Query<T> {
  const { client, config } = useRecon();
  const { enabled = true, pollMs } = options;
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<ReadState<T>>();
  const runRef = useRef(run);
  const readKey = `${key}#${nonce}`;

  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const value = await runRef.current(client, config);
        if (live) setResult({ key: readKey, data: value });
      } catch (err) {
        if (live) setResult({ key: readKey, error: err as Error });
      } finally {
        if (live && pollMs) timer = setTimeout(tick, pollMs);
      }
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // readKey identifies this read, and changes when reload() is called
  }, [client, config, readKey, enabled, pollMs]);

  const settled = result?.key === readKey ? result : undefined;
  return {
    data: settled?.data ?? (result?.data as T | undefined),
    error: settled?.error,
    loading: enabled && !settled,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

export const useDeployment = (): Query<DeploymentCheck> => useRead("deployment", (c, cfg) => validateDeployment(c, cfg));
export const useProtocol = (): Query<ProtocolInfo> => useRead("protocol", (c, cfg) => reads.protocol(c, cfg));
export const useRecons = (limit = 50): Query<Page<Recon>> =>
  useRead(`recons:${limit}`, (c, cfg) => reads.list(c, cfg, 0, limit), { pollMs: 30_000 });
export const useTransitions = (limit = 50): Query<Page<Transition>> =>
  useRead(`transitions:${limit}`, (c, cfg) => reads.transitions(c, cfg, 0, limit), { pollMs: 30_000 });

export type ReconView = { recon: Recon; results: ReconResult[]; history: Transition[] };

/** One request with every result (oldest first) and its history (oldest first). */
export function useReconView(id: string, pollMs?: number): Query<ReconView> {
  return useRead(`recon:${id}`, async (c, cfg) => {
    const recon = await reads.recon(c, cfg, id);
    const [results, history] = await Promise.all([reads.results(c, cfg, id, 0, 50), reads.history(c, cfg, id, 0, 50)]);
    return { recon, results: [...results.items].reverse(), history: [...history.items].reverse() };
  }, { pollMs });
}

export function useMyRecons(address?: string): Query<Page<Recon>> {
  return useRead(`mine:${address ?? ""}`, (c, cfg) => reads.byCreator(c, cfg, address!, 0, 50), { enabled: !!address });
}

/** The contract's transactions as StudioNet lists them. Display only. */
export function useChainTxs(pollMs?: number): Query<ChainTx[]> {
  return useRead("chain-txs", (_c, cfg) => contractTransactions(cfg), { pollMs });
}

/** The browser clock in UTC seconds, for display and form previews only. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ── writing ─────────────────────────────────────────────────────────────────

export type SendOptions = {
  call: Call;
  /** Resolves true once the contract's own view reflects the write. */
  reconciled: () => Promise<boolean | string>;
  /** As soon as the contract's state shows the write. */
  onRecorded?: () => void;
  /** Once the whole write has ended, finality included. */
  onSettled?: (final: TxState) => void;
};

export type Sender = {
  state: TxState;
  busy: boolean;
  send: (options: SendOptions) => Promise<TxState>;
  reset: () => void;
};

/** One write at a time, with the transaction's own lifecycle. */
export function useSend(): Sender {
  const { config, client: reader } = useRecon();
  const wallet = useWallet();
  const deployment = useDeployment();
  const [state, setState] = useState<TxState>(initialTx);

  const send = useCallback(
    async ({ call, reconciled, onRecorded, onSettled }: SendOptions) => {
      const refuse = (message: string, failure: TxState["failure"]) => {
        const next: TxState = { ...initialTx, phase: "FAILED", message, failure };
        setState(next);
        return next;
      };
      const blocked = preflight({ status: wallet.status, account: wallet.account, chainId: wallet.chainId,
                                  hasProvider: !!wallet.provider }, config.chainId, deployment.data);
      if (blocked || !wallet.account || !wallet.provider) {
        return refuse(blocked?.message ?? "Connect a wallet first.", blocked?.kind ?? "TRANSACTION_FAILED");
      }
      const final = await runWrite({
        config,
        client: writeClient(config, wallet.account, wallet.provider),
        functionName: call.functionName,
        args: call.args,
        value: call.value,
        reconciled,
        onRecorded,
        poller: reader,
        onUpdate: setState,
      });
      onSettled?.(final);
      return final;
    },
    [config, deployment.data, reader, wallet.account, wallet.chainId, wallet.provider, wallet.status],
  );

  // busy until the contract's own state shows the write (or it failed); finality is tracked after
  const busy = state.phase === "RUNNING" && state.happened < 6;
  return { state, busy, send, reset: useCallback(() => setState(initialTx), []) };
}
