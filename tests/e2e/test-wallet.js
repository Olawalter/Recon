/**
 * A test wallet for the in-app end-to-end run. Test tooling only: never
 * bundled, never loaded by the app.
 *
 * Pasted into a page of the running app (browser devtools or an automation
 * tool), it announces one EIP-6963 wallet per throwaway key, exactly as
 * MetaMask or Rabby would, so the app's own discovery, connect, network check
 * and transaction code run unmodified. The one call it answers itself is
 * `eth_sendTransaction`: it signs the transaction genlayer-js composed and
 * sends it raw. Every other request goes to StudioNet unchanged.
 *
 *   await installTestWallets([{ name: "Creator", key: "0x…" }, …])   // after pasting this file
 *
 * Each signed write is appended to `window.__reconE2E` with its hash, so the
 * run's transactions can be read back and checked on the explorer.
 */
async function installTestWallets(wallets, rpc = "https://studio.genlayer.com/api") {
  const { privateKeyToAccount } = await import("https://cdn.jsdelivr.net/npm/viem@2.21.55/accounts/+esm");
  const CHAIN_ID = 61999;
  const record = (window.__reconE2E = window.__reconE2E || []);
  let id = 0;

  async function call(method, params = []) {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const out = await res.json();
    if (out.error) throw Object.assign(new Error(out.error.message), { code: out.error.code, data: out.error.data });
    return out.result;
  }

  const announced = wallets.map(({ name, key }) => {
    const account = privateKeyToAccount(key);
    const listeners = {};
    const provider = {
      isReconTestWallet: true,
      async request({ method, params }) {
        switch (method) {
          case "eth_requestAccounts":
          case "eth_accounts":
            return [account.address];
          case "eth_chainId":
            return "0x" + CHAIN_ID.toString(16);
          case "wallet_switchEthereumChain":
          case "wallet_addEthereumChain":
            return null;
          case "eth_sendTransaction": {
            const t = params[0];
            if (t.from && t.from.toLowerCase() !== account.address.toLowerCase()) {
              throw Object.assign(new Error("from is not this wallet's account"), { code: 4100 });
            }
            const signed = await account.signTransaction({
              type: "legacy",
              chainId: CHAIN_ID,
              to: t.to,
              data: t.data,
              value: BigInt(t.value || 0),
              gas: BigInt(t.gas),
              gasPrice: BigInt(t.gasPrice || (await call("eth_gasPrice"))),
              nonce: Number(BigInt(t.nonce ?? (await call("eth_getTransactionCount", [account.address, "pending"])))),
            });
            const hash = await call("eth_sendRawTransaction", [signed]);
            record.push({ wallet: name, from: account.address, value: t.value || "0x0", hash, at: new Date().toISOString() });
            return hash;
          }
          default:
            return call(method, params || []);
        }
      },
      on(event, handler) {
        (listeners[event] = listeners[event] || new Set()).add(handler);
      },
      removeListener(event, handler) {
        listeners[event]?.delete(handler);
      },
    };
    const detail = Object.freeze({
      info: {
        uuid: "recon-test-" + account.address.toLowerCase(),
        name: "Test wallet: " + name,
        icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><rect width='8' height='8' fill='%23888'/></svg>",
        rdns: "test.recon." + name.toLowerCase(),
      },
      provider,
    });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    return { name, address: account.address };
  });
  return announced;
}

// Pasting this file defines the installer for the page it is pasted into.
globalThis.installTestWallets = installTestWallets;
