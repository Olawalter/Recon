"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { configResult, hexChain } from "@/lib/genlayer/config";

/**
 * Injected wallets, discovered through EIP-6963 so every installed wallet is
 * offered by its own name (MetaMask, Rabby, Trust Wallet, Coinbase Wallet and
 * anything else that announces itself); a wallet that only sets
 * window.ethereum is offered as "Browser wallet". Nothing here holds, asks for
 * or stores a key: the wallet signs, the app never does.
 */

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
type Detected = { info: ProviderInfo; provider: Eip1193Provider };

export type WalletState = {
  wallets: Detected[];
  account?: `0x${string}`;
  chainId?: number;
  provider?: Eip1193Provider;
  walletName?: string;
  status: "disconnected" | "connecting" | "connected";
  error?: string;
  connect: (w: Detected) => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
};

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet outside WalletProvider");
  return ctx;
}



/**
 * EIP-6963 discovery as an external store: the subscription attaches the
 * listener and then asks, so a wallet that announced before this component
 * mounted is still collected, and React reads the list rather than being told
 * about it from inside an effect.
 */
const discovery = (() => {
  let list: Detected[] = [];
  const listeners = new Set<() => void>();
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<Detected>).detail;
    if (!detail?.info?.uuid || list.some((w) => w.info.uuid === detail.info.uuid)) return;
    list = [...list, detail];
    listeners.forEach((l) => l());
  };
  return {
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        window.addEventListener("eip6963:announceProvider", announce as EventListener);
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
        if (injected && list.length === 0) {
          list = [{ info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: injected }];
        }
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener("eip6963:announceProvider", announce as EventListener);
      };
    },
    get: () => list,
    server: [] as Detected[],
  };
})();

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallets = useSyncExternalStore(discovery.subscribe, discovery.get, () => discovery.server);
  const [account, setAccount] = useState<`0x${string}` | undefined>();
  const [chainId, setChainId] = useState<number | undefined>();
  const [current, setCurrent] = useState<Detected | undefined>();
  const [status, setStatus] = useState<WalletState["status"]>("disconnected");
  const [error, setError] = useState<string | undefined>();


  const readChain = useCallback(async (provider: Eip1193Provider) => {
    try {
      const id = (await provider.request({ method: "eth_chainId" })) as string;
      setChainId(Number(id));
    } catch {
      setChainId(undefined);
    }
  }, []);

  const connect = useCallback(
    async (wallet: Detected) => {
      setStatus("connecting");
      setError(undefined);
      try {
        const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
        const first = accounts?.[0];
        if (!first) throw new Error("The wallet returned no account.");
        setAccount(first as `0x${string}`);
        setCurrent(wallet);
        setStatus("connected");
        await readChain(wallet.provider);
      } catch (err) {
        setStatus("disconnected");
        setError(
          (err as { code?: number })?.code === 4001
            ? "You declined the connection in your wallet."
            : ((err as Error)?.message ?? "The wallet could not be connected."),
        );
      }
    },
    [readChain],
  );

  const disconnect = useCallback(() => {
    setAccount(undefined);
    setCurrent(undefined);
    setStatus("disconnected");
  }, []);

  // account and network changes, as the wallet reports them
  useEffect(() => {
    const provider = current?.provider;
    if (!provider?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts?.length) disconnect();
      else setAccount(accounts[0] as `0x${string}`);
    };
    const onChain = (...args: unknown[]) => setChainId(Number(args[0] as string));
    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    return () => {
      provider.removeListener?.("accountsChanged", onAccounts);
      provider.removeListener?.("chainChanged", onChain);
    };
  }, [current, disconnect]);

  const switchNetwork = useCallback(async () => {
    const provider = current?.provider;
    if (!provider || !configResult.ok) return;
    const { chainId: want, rpcUrl, explorer } = configResult.config;
    setError(undefined);
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChain(want) }] });
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code === 4902 || code === -32603) {
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: hexChain(want),
                chainName: "GenLayer StudioNet",
                nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
                rpcUrls: [rpcUrl],
                blockExplorerUrls: [explorer],
              },
            ],
          });
        } catch (addErr) {
          setError((addErr as Error)?.message ?? "The wallet would not add this network.");
          return;
        }
      } else if (code === 4001) {
        setError("You declined the network switch in your wallet.");
        return;
      } else {
        setError((err as Error)?.message ?? "The wallet would not switch network.");
        return;
      }
    }
    await readChain(provider);
  }, [current, readChain]);

  const value = useMemo<WalletState>(
    () => ({
      wallets,
      account,
      chainId,
      provider: current?.provider,
      walletName: current?.info.name,
      status,
      error,
      connect,
      disconnect,
      switchNetwork,
    }),
    [wallets, account, chainId, current, status, error, connect, disconnect, switchNetwork],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
