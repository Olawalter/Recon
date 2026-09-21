<p align="center"><img src="app/icon.svg" width="72" alt="RECON"></p>

<h1 align="center">RECON</h1>

<p align="center"><b>When information conflicts, consensus establishes the state.</b><br>
Decentralized reconciliation of conflicting external information, on GenLayer.</p>

---

## The problem

Status pages, registries, APIs, news and documentation disagree. They go stale, and they copy one
another. When a smart contract, an agent or a person needs one answer, someone has to decide which
source to believe. Today that is usually one server: it fetches some pages, reads them its own way and
publishes an answer nobody can check. Whoever runs it decides the answer.

## What RECON does

A request fixes, once and for all:

- a question;
- 2 to 6 sources allowed to answer it;
- the form the answer must take;
- a reconciliation policy;
- an observation window;
- a freshness requirement;
- a GEN bond.

When the request is observed, every GenLayer validator fetches every source itself. Each one reports
what each source states, with the exact passage that states it. The contract then applies the policy
in code:

- sources are counted by **publisher**, not by URL;
- a source that repeats another adds no voice;
- a missing page is not a contradiction;
- evidence outside the freshness requirement is kept out.

If the policy is met, the result is the state. If it is not, the result is `UNRESOLVED`, never a
guess. Results are immutable and every change of state is recorded in the history.

## Why GenLayer is necessary

Reading a page and saying what it claims is judgement, and a single operator's judgement is exactly
what a conflict puts in doubt. On GenLayer that judgement is repeated independently. The leader
proposes a reading, and each validator repeats the whole task on its own fetch, with its own model. A
result is recorded only when they agree on:

- every source's claim, date, freshness and independence;
- the policy's outcome.

A passage any one of them did not see cannot be stored.

What can be deterministic is kept out of consensus: grouping by publisher, freshness arithmetic, the
policy and the bond are plain code, identical on every node. The model reads; it never decides the
state, and it never sees the bond. See [docs/architecture.md](docs/architecture.md).

| Decided by | What |
|---|---|
| Contract code | validation, source normalization, publisher grouping, freshness, the policy, the state, history, expiry, the bond |
| GenLayer consensus | fetching each source and reading what it states, the passage that states it, its date, whether it repeats another source |
| The interface | forms, previews, wallet requests and display; it decides nothing and stores nothing |

## How reconciliation works

| Policy | Resolves when |
|---|---|
| Majority | more than half of the counted publishers agree, and at least the minimum |
| Threshold | the leading claim's share of counted publishers reaches the set basis points |
| Authority confirmation | the source declared official agrees with enough independent confirmations |
| Strict | every counted publisher agrees |

| Status | Meaning |
|---|---|
| `RESOLVED` | the policy was met; the state is the agreed claim |
| `UNRESOLVED_INSUFFICIENT` | too few independent, current, grounded sources |
| `UNRESOLVED_CONFLICT` | enough sources, but they disagree beyond what the policy allows |

A claim counts only if it is grounded: its passage must be in that node's own copy of the page, and
a number or date must be written in that passage. Pages are fenced as untrusted data; a page that
tells the panel what to answer is recorded as making no claim. Details:
[docs/contract.md](docs/contract.md).

## Lifecycle

```text
                    create_recon (GEN bond attached)
                              │
                              ▼
   cancel (creator,     SUBMITTED ─────────── observe_recon ──────────┐
   never observed) ◄──       │                (inside the window)     │
        │                    │                                        ▼
        ▼                    │                               PROPOSED  result R0, R1 …
   CANCELLED                 │                                        │
                             │                          300 s  finalize_result
                             │                                        ▼
                             │                               FINALIZED ── expire_result ─► state EXPIRED
                             │                                        │    (after its validity)
                             │                    ≥ 15 min later, observe again ──► PROPOSED …
                             ▼                                        ▼
                  window ends: close_recon ──► CLOSED (a result was final) / FAILED (none)

   bond:   LOCKED ──── cancel / close ────► REFUNDABLE ──── refund_bond ────► REFUNDED
```

## How the bond works

Every request carries a GEN bond, sent as the value of the creating transaction. It discourages spam
and meaningless requests. It is **not** a stake on the answer, a reward or a vote: the reconciliation
never reads it.

- The contract holds it until the observation window closes, or until the creator cancels a request
  that was never observed.
- Anyone may then send `refund_bond`, and the whole deposit goes to the recorded creator, exactly once.
- A creation the contract cannot accept sends the attached GEN straight back and records why.

See [docs/bond-model.md](docs/bond-model.md).

## Verified on StudioNet

<!-- verified:start -->
**In the app** (2026-09-21): request #17 was created with a 0.02 GEN bond, observed, finalized as **2023-10-02** (RESOLVED), closed and refunded. That is 5 wallet-signed transactions, all FINALIZED with MAJORITY_AGREE.

**Live suite** (2026-09-21): 7 reconciliations, 8 walls refused in the contract's own words, every bond refunded.

| Case | Outcome | Observation |
|---|---|---|
| Two pages of one publisher are one voice; a missing page is not a contradiction | RESOLVED | [`0xfdad614e…f3eec1`](https://explorer-studio.genlayer.com/tx/0xfdad614ef500450f1da527c572cf2ccf90c8971675bfc0c4e1f991de47f3eec1) |
| Majority resolves against one conflicting source | RESOLVED | [`0x7f33d557…ab9d4e`](https://explorer-studio.genlayer.com/tx/0x7f33d55758c8ebe36b7a406c6a5c55d2502c1ca09747116e604dc6ddb2ab9d4e) |
| Strict leaves the same evidence unresolved | UNRESOLVED_CONFLICT | [`0x6616f279…0e528d`](https://explorer-studio.genlayer.com/tx/0x6616f279c7fb70d1703ac8503c014a91678cd3fd0ec3a10ca88b9a64320e528d) |
| A source that repeats another adds no voice | UNRESOLVED_INSUFFICIENT | [`0xaaa7ae42…73e884`](https://explorer-studio.genlayer.com/tx/0xaaa7ae42993b1f2f1402c777327b4b047571af7f425e3ce935ed5c55a773e884) |
| Old evidence is stale when freshness is required | UNRESOLVED_INSUFFICIENT | [`0xe3254a9d…b07be3`](https://explorer-studio.genlayer.com/tx/0xe3254a9dea95133c6a023cd4d05f058b538615c3ee49ab89e00670b368b07be3) |
| An official source, independently confirmed | RESOLVED | [`0x6b2adf29…587d82`](https://explorer-studio.genlayer.com/tx/0x6b2adf29a2d437dbc7a90ba670cc67956f03b16240505dd0a76c27e5a3587d82) |
| A page that tries to instruct the panel | RESOLVED | [`0xe4eb7a50…8920bf`](https://explorer-studio.genlayer.com/tx/0xe4eb7a50ef4e300b8e81cda72d66ee5c22f8e67eca97cf1baebf920fe08920bf) |

Full record: [docs/e2e.md](docs/e2e.md).
<!-- verified:end -->

## Using it

**Connect a wallet.** Any injected browser wallet works (MetaMask, Rabby and others; they are
discovered through EIP-6963). Choose **Connect wallet**. If the wallet is on another network, the app
offers to switch to GenLayer StudioNet (chain 61999). RECON never asks for, sees or stores a key.

**Create a reconciliation.** Go to **Create Recon** and work through the eight steps:

1. question;
2. sources, each with an optional label and a declared class;
3. answer form;
4. policy;
5. observation window;
6. freshness;
7. bond;
8. review. The review shows exactly what will be frozen, including how the sources group by
   publisher.

Confirm the transaction in your wallet. It carries the bond as its value. The page follows the
transaction through GenLayer's stages and opens the request once the contract shows it.

**Observe and finalize.** On the request's page, **What can be done now** lists only the acts the
contract will accept at that moment, and says why the others must wait.

- *Observe now* asks GenLayer to read every source and record a result.
- After the contract's 300-second finality delay, *Finalize the result* makes it the request's state.
- Once the window has ended, *Close the request* and then *Refund the bond* return the GEN to the
  creator.

Anyone may send these acts. The page shows the evidence map, the conflict graph, each source's status,
the state history, the GenLayer lifecycle with the validators' recorded votes, and the bond.

**Finality.** A result is first accepted by GenLayer's consensus. It becomes the request's state only
after the contract's own finality delay, when `finalize_result` is sent. The interface never calls
anything current that the contract has not finalized. A result past its validity is not shown as
current, and can be recorded as expired.

## Running the tests

```bash
pip install -r requirements.txt
python scripts/fetch_genvm_bundle.py              # once, on a cold cache
genvm-lint check contracts/recon.py --json
python -m pytest tests/direct -v                  # 186 GenVM direct-mode tests
python scripts/mutate.py                          # the mutation sweep over the contract

npm ci
npm run lint
npm run typecheck
npm test                                          # the interface, pinned to the deployed schema
npm run build

SKIP_INTEGRATION=0 RECON_CONTRACT=0x39C9137F746BfA133Dc04776ffcCF876370D01E8 \
RECON_DEMO_COMMIT=d0266e37af45211e488b286327745a9f7d3fbab9 \
python -m pytest tests/integration -v -s           # live StudioNet, about 40 minutes
```

The live suite writes `docs/live-e2e.json`. `python scripts/render_e2e.py` turns the records into
[docs/e2e.md](docs/e2e.md) and the block above.

## Deploying

```bash
python scripts/deploy.py                          # deploys, waits for finality, proves the code byte-identical
python scripts/verify_deployment.py <address>     # re-verifies any deployment from the chain alone
```

Set `NEXT_PUBLIC_RECON_CONTRACT` (with `NEXT_PUBLIC_GENLAYER_NETWORK=studionet` and
`NEXT_PUBLIC_GENLAYER_CHAIN=61999`) and build the app. See [docs/deployment.md](docs/deployment.md).

## Repository

```text
contracts/recon.py        the Intelligent Contract
app/, components/, lib/   the Next.js interface
tests/direct/             GenVM direct-mode tests
tests/integration/        the live StudioNet suite
tests/frontend/           interface tests
tests/e2e/                the test wallet used for the in-app run
scripts/                  deploy, verify, mutation sweep, records
demo/                     the demonstration pages used as conflicting, derived and injected sources
docs/                     architecture, contract, bond model, end-to-end record, deployment, security
```

| Document | |
|---|---|
| [architecture.md](docs/architecture.md) | trust model, responsibility split, source of truth per displayed value |
| [contract.md](docs/contract.md) | methods, terms, publishers, the observation, policies, lifecycles |
| [bond-model.md](docs/bond-model.md) | custody, refund order, emitted versus confirmed |
| [e2e.md](docs/e2e.md) | every transaction of the in-app run and the live suite |
| [deployment.md](docs/deployment.md) | the deployment of record and how to reproduce it |
| [security.md](docs/security.md) | the security review |
| [genlayer-api-notes.md](docs/genlayer-api-notes.md) | the GenLayer APIs this build relies on, as verified |
