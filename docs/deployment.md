# Deployment

RECON runs on **GenLayer StudioNet**: chain id 61999, RPC `https://studio.genlayer.com/api`, explorer
`https://explorer-studio.genlayer.com`. StudioNet is gasless for development and funds any address
through its `sim_fundAccount` RPC method, so no faucet form, key or account is needed.

## The deployment of record

Every field below is read from [deployment.json](deployment.json), which `scripts/deploy.py` wrote from
the chain.

| | |
|---|---|
| Contract | `0x895c056714414425F308dA6f65fBE4d4eCb8e775` |
| Deploy transaction | `0xcf61e9e3…571d07`, FINALIZED, MAJORITY_AGREE |
| Source | `contracts/recon.py` at `c44d984`, 71,647 bytes |
| sha256, source and on chain | `b9f2a602ee2a09a0ed493352e3ce12f20c0e49d58ac9c4937a2ee0639771e73f` (byte-identical) |
| Protocol | `RECON-1.0.0` |
| Runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Toolchain | genlayer CLI 0.39.2, genlayer-py 0.16.3, genlayer-test 0.29.2, genvm-linter 0.11.0, genlayer-js 1.1.8 |

The contract has no owner and no admin method. The deployer was a throwaway, faucet-funded account that
holds no privilege.

## Deploying

```bash
pip install -r requirements.txt
genvm-lint check contracts/recon.py --json
python scripts/deploy.py
```

`deploy.py` deploys the contract **as git stores it** at the chosen revision, so the bytes on chain are
the repository's bytes. It then waits for FINALIZED, reads the code back with `gen_getContractCode` and
refuses to report success unless it is byte-identical. It also reads the schema and
`get_protocol_info`, writes `docs/deployment.json` and prints the frontend's environment lines.

The GenLayer CLI can do the same by hand:

```bash
genlayer network set studionet
genlayer deploy --contract contracts/recon.py
genlayer schema <address>
genlayer code <address>
```

Bradbury and Asimov are listed by `genlayer network list` but are funded testnets with their own faucet
and fee rules. RECON has not been deployed there, and its fee handling has not been tested there.

## Verifying any deployment

```bash
python scripts/verify_deployment.py 0x895c056714414425F308dA6f65fBE4d4eCb8e775 --recon 17
```

This reads from StudioNet only. It checks:

- the deployed code, compared byte for byte with the source;
- the schema;
- `get_protocol_info`;
- every request with its status, state and bond;
- with `--recon`, one request's results and history.

`--write-schema` refreshes `lib/genlayer/recon-schema.json`. The frontend's interface tests pin the app's calls to that file.

The in-app run is in [e2e.md](e2e.md). Together they cover the brief's verification list:

- address, schema and code: this page;
- reads, a real payable request, the transaction lifecycle, the finalized result, evidence, bond
  state and history: e2e.md.

To diagnose a failed transaction:

```bash
genlayer receipt <txHash> --stdout --stderr
```

## The frontend

A static Next.js app; nothing runs on a server. Three public variables configure it (`.env.example`):

```bash
NEXT_PUBLIC_GENLAYER_NETWORK=studionet
NEXT_PUBLIC_GENLAYER_CHAIN=61999
NEXT_PUBLIC_RECON_CONTRACT=0x895c056714414425F308dA6f65fBE4d4eCb8e775
```

The contract address lives in exactly that one variable. With a wrong network or chain id, or a malformed address, the app shows what is wrong instead of running. On load it compares the deployed schema with the methods it calls, and says so if they differ.

```bash
npm ci
npm run build
npm start
```

On Vercel: import the repository with the project root as the root directory, set the three variables,
and deploy. When the contract is redeployed, update `NEXT_PUBLIC_RECON_CONTRACT` and redeploy the site;
the build reads it at build time.
