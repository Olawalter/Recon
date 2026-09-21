# The contract

`contracts/recon.py`, one Intelligent Contract, runner `py-genlayer:1jb45aa8…` (pinned on line 1).
Protocol `RECON-1.0.0`, policy rules `RECON-POLICY-1`. The deployment of record, and the proof that its
on-chain code is byte-identical to this file, is in [deployment.md](deployment.md).

## Methods

### Writes

| Method | Who | Value | What it does |
|---|---|---|---|
| `create_recon(question, terms_json, bond_required)` | anyone | the bond | Validates the terms, records the request and its bond. Returns the request id, or `""` if the terms were refused after GEN was attached (the value is sent back in the same transaction and logged in `returned_deposits`). |
| `cancel_recon(recon_id)` | the creator | none | Before any observation only. The bond becomes `REFUNDABLE`. |
| `observe_recon(recon_id)` | anyone | none | Inside the window, at most once per 15 minutes, and not while a result is pending. Runs the nondeterministic reading, reconciles it in code and records a new result `PROPOSED`. Returns the result id. |
| `finalize_result(recon_id)` | anyone | none | After `FINALITY_DELAY_SECONDS` (300) from the proposal. The pending result becomes the request's state and a history transition is written. |
| `expire_result(recon_id)` | anyone | none | After the latest final result's `valid_until`. Records an `EXPIRED` transition; the state becomes `EXPIRED`. Results themselves are never altered. |
| `close_recon(recon_id)` | anyone | none | After the window ends. `CLOSED` if a result was ever final, `FAILED` if none was. The bond becomes `REFUNDABLE`. |
| `refund_bond(recon_id)` | anyone | none | Sends the stored deposit to the recorded creator. See [bond-model.md](bond-model.md). |

Every refusal is a `gl.vm.UserError` whose message begins `[EXPECTED]` and names the rule, for example
`[EXPECTED] the observation window is open until 1789991696`.

### Views

| Method | Returns |
|---|---|
| `get_protocol_info()` | version, rules, every enumeration and limit, `recon_count`, `total_bonded` |
| `get_recon(recon_id)` | the request: frozen terms, status, bond ledger, current state, timestamps |
| `get_result(result_id)` / `get_results(recon_id, offset, limit)` | results `<id>-R0`, `<id>-R1`, … with every evidence row |
| `get_history(recon_id, offset, limit)` / `list_transitions(offset, limit)` | finalized state transitions, per request or across the contract |
| `list_recons(offset, limit)` / `list_by_creator(creator, offset, limit)` | requests, paged (at most 50) |
| `get_returned_deposits(offset, limit)` / `returned_for(sender, offset, limit)` | deposits sent back with the reason |

## The terms

`terms_json` is frozen at creation. Nothing about a request can change afterwards.

| Field | Rule |
|---|---|
| `sources` | 2 to 6 `{url, label?, declared_class?}`. `https` only, no credentials in the address, a dotted host name (so no `localhost`); normalized (case, `www.`, port 443, fragment, trailing slash, `utm_` parameters) and de-duplicated. The contract does not filter private address ranges: sources are fetched by GenLayer's validators, not by any RECON server. `declared_class` is `OFFICIAL`, `INDEPENDENT` or `UNKNOWN`, and is the creator's claim, used only by `AUTHORITY_CONFIRMATION`. |
| `result_type` | `CATEGORICAL` (2 to 8 capitalized values), `BOOLEAN`, `NUMERIC` (unit, decimals ≤ 6, tolerance ≤ 2000 bps) or `TEMPORAL` (a date) |
| `policy` | `MAJORITY {min_groups}`, `THRESHOLD {min_groups, threshold_bps}`, `AUTHORITY_CONFIRMATION {min_confirmations}` or `STRICT {min_groups}`; `stale_contributes` optional |
| `observation_window_start` / `_end` | at least 10 minutes long; may open up to 5 minutes before the creating transaction |
| `freshness_requirement` | seconds; 0 means age is not a condition |
| `validity_seconds` | how long a final result stays current |

A request must have at least as many independent origins as its policy needs, or it is refused at
creation: a request that could never resolve is not accepted.

## Origins: counting publishers, not URLs

`_origin(url)` is deterministic and the same on every node. Two addresses run by one publisher are one
voice:

- `github:<owner>` for github.com, raw.githubusercontent.com, gist, api.github.com/repos/<owner>,
  `<owner>.github.io` and jsDelivr `/gh/<owner>`;
- `npm:<package>` for registry.npmjs.org, unpkg, jsDelivr `/npm` and npmjs.com/package;
- otherwise the registrable domain (`docs.python.org` and `www.python.org` are both `python.org`),
  with two-level public suffixes such as `co.uk` handled.

A source is also joined to another's group when it is found to be **derived** from it. That is only
accepted when the source's own words name the other source's host or label, or reproduce at least 60
characters of its text. A model saying "this looks copied" is not enough.

## The observation

`observe_recon` calls `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`.

**On every node**, `_read_sources`:

1. fetches each source with `gl.nondet.web.get`, bounded to 1 MB, decompressing gzip/deflate bodies
   (python.org gzips regardless of `Accept-Encoding`). 404/410 is `MISSING`, anything else that is
   not a readable 2xx is `UNAVAILABLE`; neither is ever a contradiction;
2. reduces the body to text, keeps up to 5,000 characters around what the question asks, and reads
   the `Last-Modified` header and the dates the text states;
3. asks the model, once, with every source fenced as untrusted data, what each source states in the
   request's answer form, the passage that states it, the date it gives for its information, and
   whether it says it repeats another listed source;
4. normalizes each claim in code (`_normalize_claim`) and keeps it only if its passage is found in
   that node's own copy of the page, and the value itself is written in that passage
   (`_claim_grounded`). An unsupported claim becomes "no claim".

Then, in code, `_reconcile` computes freshness from the dates, groups sources by origin and
derivation, lets each group speak once, and applies the policy. The model is never asked which
source is right or what the state is, and never sees the bond.

**Leader.** The leader returns the rows and the reconciliation.

**Validators.** Each validator repeats the whole reading itself and compares a fingerprint of the
decision-bearing fields (`_fingerprint`): every source's availability, claim, freshness and
derivation, the groups, the status and the state. Numbers agree within the request's own tolerance
(`_numbers_agree`). Every passage the leader would store must also appear in the validator's own copy,
compared with digits masked so that the tolerance is not undone by an exact-text check (`_quotes_hold`),
and each stored figure or date must be stated in its own quote. A row that is not well formed
(`_well_formed`, including consistency of unread rows) is rejected outright. The leader's result is
accepted only if all of this matches.

**Errors.** `[EXPECTED]` and `[EXTERNAL]` errors must match exactly; `[TRANSIENT]` agrees with
`[TRANSIENT]`; `[LLM_ERROR]` or an unclassified error disagrees, so the round rotates
(`_handle_leader_error`). If consensus is not reached, nothing is recorded and the request can be
observed again.

## Reconciliation policy

Only sources that were readable, made a grounded claim and are `CURRENT` count (or `STALE` too if
`stale_contributes`). Undated evidence is stale when freshness is required. A source dated more than a
day after the observation is `CONFLICTING` in freshness and does not count.

| Policy | Resolves when |
|---|---|
| `MAJORITY` | the leading claim is backed by more than half of the counted groups, and by at least `min_groups` |
| `THRESHOLD` | the leading claim's share of counted groups is at least `threshold_bps`, and at least `min_groups` back it |
| `AUTHORITY_CONFIRMATION` | every source declared official agrees, and at least `min_confirmations` other groups confirm it |
| `STRICT` | no counted group disagrees, and at least `min_groups` agree |

Too few counted groups is `UNRESOLVED_INSUFFICIENT`, reported before any conflict. Enough groups
that fail the policy is `UNRESOLVED_CONFLICT`. Either way the state is `UNRESOLVED`, never a guess.

## Lifecycles

```text
request   SUBMITTED ──observe──► PROPOSED ──finalize──► FINALIZED ──observe (≥15 min later)──► PROPOSED …
             │                                              │
             ├──cancel (creator, never observed)──► CANCELLED
             └──────────── window ends: close ──────────────┴──► CLOSED (a result was final) / FAILED (none)

bond      LOCKED ──cancel / close──► REFUNDABLE ──refund_bond──► REFUNDED

result    PROPOSED ──300 s──► FINALIZED        immutable; expiry is a new EXPIRED transition, not an edit
```

## Limits

| | |
|---|---|
| Sources per request | 2 to 6 |
| Bond | 0.001 GEN to 1,000,000 GEN |
| Window | 10 minutes to 366 days |
| Finality delay | 300 seconds |
| Observation interval | 15 minutes |
| Results per request | 100 |
| Page size on every list | 50 |
