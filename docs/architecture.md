# Architecture

RECON has two parts: one Intelligent Contract on GenLayer StudioNet, and a static Next.js interface
that reads it and asks the user's own wallet to sign. There is no backend, no database, no oracle
operator, no validator server of RECON's own and no server-side signer.

## The trust model

```text
User
 ↓  signs with an injected wallet (EIP-1193, discovered through EIP-6963)
GenLayerJS
 ↓  writeContract / readContract
GenLayer Chain (StudioNet)
 ↓
RECON Intelligent Contract  (contracts/recon.py)
 ↓  observe_recon
GenVM
 ↓  gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
Nondeterministic evidence evaluation
 ↓  each node: gl.nondet.web.get every source, gl.nondet.exec_prompt to read what each states
Leader proposal
 ↓  the leader's reading, normalized and grounded in its own fetch, reconciled in code
Independent validators
 ↓  each validator repeats the whole task itself and compares decision-bearing fields
Equivalence Principle
 ↓  exact on claims, freshness, derivation, groups, state; numbers within the request's tolerance;
 ↓  every stored passage must be in the validator's own copy
Optimistic Democracy
 ↓  accepted on majority agreement; appealable during GenLayer's window
Finalized state
    the contract's own finality delay, then finalize_result makes it the request's state
```

## Who decides what

| Decided by | What |
|---|---|
| **Contract code, deterministic** | request validation, source normalization and de-duplication, origin grouping, bond custody, timestamps and windows, freshness from dates, the reconciliation policy, the final state, history, expiry, refunds |
| **GenLayer consensus, nondeterministic** | fetching each permitted source, reading what each one states in the request's own answer form, finding the passage that states it, the date it gives, and whether it says it repeats another listed source |
| **The model** | reading only. It is asked what each source states, never which source is right, never what the state is, and never sees the bond |
| **The interface** | forms, previews, signing requests and display. It decides nothing and stores nothing |

The model returns findings; code derives the result. A claim counts only if the model's quote is found
in that node's own copy of the page, and for numbers and dates only if the value itself is written in
that quote. A derivation counts only if the source's own words name the other source or reproduce a
passage of it. What remains is applied to the policy in code, identically on every node.

## Why a centralized API cannot replace it

The product's question is exactly the one a single operator cannot be trusted to answer: when
reliable sources disagree, what is the state? A server that fetches the pages, asks a model and
writes an answer on chain would make that server's reading authoritative. Whoever runs it decides
which pages load, which model reads them, what counts as a copy, and what is published; and nobody can
check what it saw. That is the trust RECON removes.

On GenLayer, the reading itself is what consensus is reached on. Several validators, running different
models, fetch the same sources independently at the same observation. A result is recorded only when
they agree on every source's availability, claim, date, freshness and derivation, and on the policy's
outcome; a passage any one of them did not see cannot be stored. If they cannot agree, nothing is
recorded and the request can be observed again. The on-chain record says what the panel agreed each
source stated, not what one server reported.

What stays deterministic is deliberately kept out of consensus: origin grouping, freshness arithmetic,
policy application and the bond are code, run identically everywhere, so the only thing validators
must agree on is the part that needs judgement.

## Components

```text
contracts/recon.py            the protocol
app/                          routes: /, /dashboard, /create, /recon/[id], /history
components/
  wallet/                     connect, disconnect, network mismatch
  recon/                      detail page, dashboard, history, create flow, acts, chips
  evidence/                   the evidence map
  conflict-graph/             the conflict graph (SVG on wide screens, a grouped list on narrow ones)
  consensus/                  the transaction tracker and the GenLayer lifecycle panel
  bond/                       the bond panel
  ui/                         shell, panes, notices
lib/
  genlayer/                   configuration, clients, the contract adapter, the write lifecycle, hooks
  wallet/                     EIP-6963 discovery and the connected provider
  validation/                 the create form's rules, mirroring the contract's
  formatting/                 every word the interface says about contract state
tests/direct/                 204 GenVM direct-mode tests of the contract
tests/integration/            the live StudioNet suite
tests/frontend/               70 tests of the interface, rendered from real StudioNet results
scripts/                      deploy, verify, mutation sweep, probes
```

## Source of truth, per displayed value

| Displayed | Comes from |
|---|---|
| Question, sources, policy, windows, freshness, validity | `get_recon` (the request's frozen terms) |
| Bond required, held, status, refund | `get_recon` |
| Final state | `get_recon.current_state` (set only by `finalize_result` or `expire_result`) |
| Every result: evidence, claims, passages, groups, state, summary | `get_results` / `get_result` |
| State history | `get_history`, `list_transitions` |
| Transaction status, consensus outcome, validator votes | the transaction's own record on GenLayer (`getTransaction`, `sim_getTransactionsForAddress`) |
| Contract address and network | deployment configuration (`NEXT_PUBLIC_*`), checked against the deployed schema |

The browser clock is used only to offer an act or to withhold the word "current" from a result past
its validity. It never creates a state: the contract checks every act against the transaction's own
time and refuses in its own words.
