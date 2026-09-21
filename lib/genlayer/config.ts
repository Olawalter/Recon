/**
 * The one place the app learns which network and which contract it serves.
 * Every value comes from the deployment configuration (public environment
 * variables set at build time); nothing here is a second copy of an address.
 * A missing or malformed value is reported in words on every page rather than
 * letting the app talk to the wrong contract.
 */

export type AppConfig = {
  network: "studionet";
  chainId: number;
  rpcUrl: string;
  explorer: string;
  contractAddress: `0x${string}`;
};

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

const NETWORKS = {
  studionet: {
    chainId: 61999,
    rpcUrl: "https://studio.genlayer.com/api",
    explorer: "https://explorer-studio.genlayer.com",
  },
} as const;

export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];
  const network = (env.NEXT_PUBLIC_GENLAYER_NETWORK ?? "").trim();
  const chain = (env.NEXT_PUBLIC_GENLAYER_CHAIN ?? "").trim();
  const address = (env.NEXT_PUBLIC_RECON_CONTRACT ?? "").trim();
  const rpc = (env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "").trim();

  if (network !== "studionet") problems.push("NEXT_PUBLIC_GENLAYER_NETWORK must be studionet.");
  const known = NETWORKS.studionet;
  if (chain !== String(known.chainId)) problems.push(`NEXT_PUBLIC_GENLAYER_CHAIN must be ${known.chainId} for StudioNet.`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) problems.push("NEXT_PUBLIC_RECON_CONTRACT must be the deployed contract's 0x address.");
  if (rpc && !/^https:\/\//.test(rpc)) problems.push("NEXT_PUBLIC_GENLAYER_RPC_URL must be an https address when set.");

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    config: {
      network: "studionet",
      chainId: known.chainId,
      rpcUrl: rpc || known.rpcUrl,
      explorer: known.explorer,
      contractAddress: address as `0x${string}`,
    },
  };
}

// Next.js inlines NEXT_PUBLIC_* only when each is referenced by its full name.
export const configResult: ConfigResult = readConfig({
  NEXT_PUBLIC_GENLAYER_NETWORK: process.env.NEXT_PUBLIC_GENLAYER_NETWORK,
  NEXT_PUBLIC_GENLAYER_CHAIN: process.env.NEXT_PUBLIC_GENLAYER_CHAIN,
  NEXT_PUBLIC_RECON_CONTRACT: process.env.NEXT_PUBLIC_RECON_CONTRACT,
  NEXT_PUBLIC_GENLAYER_RPC_URL: process.env.NEXT_PUBLIC_GENLAYER_RPC_URL,
});

export const hexChain = (id: number) => `0x${id.toString(16)}`;
