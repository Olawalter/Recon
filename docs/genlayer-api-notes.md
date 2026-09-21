# GenLayer API notes

Every GenLayer-specific decision in RECON, and where it was verified. The brief's rule is that no API
is used on the strength of an example; this file is the record of that rule being followed.

Recorded 21 September 2026. The documentation MCP (`docs-mcp.genlayer.com`) answered HTTP 503 for
the whole of the research phase, so the primary source was the SDK itself: the Python standard
library shipped inside the GenVM bundle that carries this contract's runner, read from
`~/.cache/genvm-linter/extracted/v0.3.0-rc7.tar/`. That is more authoritative than prose documentation
for the exact runner deployed, because it is the code that runs.

## Network

| Decision | Value | Evidence |
|---|---|---|
| Environment | GenLayer **StudioNet**, chain 61999, `https://studio.genlayer.com/api`, explorer `https://explorer-studio.genlayer.com` | the brief allows StudioNet for gasless development; the RPC answers `eth_chainId` = `0xf22f` |
| Funding | `sim_fundAccount(address, atto)` on the StudioNet RPC; no faucet key or account needed | used by `scripts/e2e_accounts.py` and the live suite |
| Chain id in the frontend | read from configuration (`NEXT_PUBLIC_GENLAYER_CHAIN`), checked against the wallet before any write | never hard-coded in components |

## Runner

`# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }` on line 1.

The bundle lists a newer runner (`1zr6nqk5…`) and `genvm-lint` suggests it, but StudioNet refused that
hash with `invalid_contract` when it was tried on 15 September 2026 and the linter's own v0.3.0-rc7
bundle cannot load it. `1jb45aa8…` is the runner StudioNet accepts. Its standard library is
`py-lib-genlayer-std:11rhn002…` (from `py-genlayer/1jb45aa8…/runner.json`).

`genvm-lint` picks the newest cached GenVM bundle, which does not carry this runner, and then fails
with `E101 Failed to load SDK`. `GENVM_VERSION=v0.3.0-rc7` pins the bundle that does.

## Contract APIs

| API | Use in RECON | Verified in |
|---|---|---|
| `class Recon(gl.Contract)`, `from genlayer import *` | the contract | std `genlayer/__init__.py` |
| `@allow_storage @dataclass`, `TreeMap`, `DynArray`, `u256`, `Address` | all persistent state | std `py/storage/` (`tree_map.py`, `annotations.py`) |
| `@gl.public.view`, `@gl.public.write`, `@gl.public.write.payable` | views, writes, the bonded `create_recon` | std `gl/annotations.py` |
| `gl.message.value` | the only source of the deposited bond | std `gl/__init__.py` |
| `gl.message.sender_address` | the creator; every recorded account is the signer | same |
| `gl.vm.UserError` | expected validation failures | std `gl/vm.py` |
| `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` | the reconciliation round, with a custom validator | std `gl/vm.py`; linter rule that every `gl.nondet` call sits directly in the closure passed to it |
| `gl.vm.Return` / `gl.vm.Result` | the validator distinguishes a leader result from a leader error | std `gl/vm.py` |
| `gl.nondet.web.get(url, headers=…)` → `Response(status: int, headers: dict[str, bytes], body: bytes \| None)` | source retrieval, including `Last-Modified` | std `gl/nondet/web.py`: `get` is wrapped by `_lazy_api`, so a plain call returns the evaluated `Response` |
| `gl.nondet.exec_prompt(prompt, response_format="json")` | claim extraction and derivation, returns a parsed object | std `gl/nondet/__init__.py` |
| `@gl.evm.contract_interface` with empty `View`/`Write`, then `.emit_transfer(value=u256)` | the single GEN transfer helper | std `gl/genvm_contracts.py`, lines 143–195 |
| transaction time | `datetime.datetime.now(datetime.timezone.utc)`: GenVM binds the clock to the transaction, so every validator reads the same instant | std runner; proven live on this runner by the transaction-time deadlines in earlier StudioNet work |

### Value-transfer semantics (the brief's §19)

`emit_transfer(self, *, value: u256, on: ON = 'finalized')`. The default `on='finalized'` means the
transfer message is **emitted to consensus only when the transaction that emits it becomes final**,
not when it is accepted. It also raises `ValueError` for a zero value.

Consequences for RECON:

- The contract zeroes the ledger and records the refund in the same transaction that emits the
  transfer, so contract state says **refund emitted** as soon as that transaction is accepted.
- The GEN actually moves when that transaction is **finalized**. The interface therefore shows
  *Refund emitted* from contract state and *Refund confirmed* only when the refund transaction's
  GenLayer status is `FINALIZED`. It never infers confirmation from contract state alone.
- `_send_gen` refuses a zero amount itself rather than relying on the `ValueError`.

### StudioNet behaviour that shapes the bond code

A payable write that raises still has its value credited to the contract on StudioNet (observed 15
September 2026). A creation that fails validation after GEN was attached therefore cannot simply
raise: the value would be stranded. RECON refuses a zero-value creation outright (nothing is at
stake), and **returns** the value of any other invalid creation in the same transaction, recording
the refusal and its reason in `returned_deposits`.

## Equivalence Principle

Custom leader/validator (`run_nondet_unsafe`), chosen before the nondeterministic code was written:

- `strict_eq` is wrong here: two honest fetches of a live page differ byte for byte, and two
  model calls never produce identical prose.
- `prompt_comparative` would compare the whole output with a second model call, which is neither
  precise nor independent of the leader's framing.
- The validator therefore **repeats the whole task itself** (its own fetches, its own model call,
  its own normalization, its own policy application) and compares only decision-bearing fields:
  per source availability, normalized claim, freshness and derivation; and the result's state,
  status, evidence sufficiency, supporting and conflicting sources. Numeric values are compared
  within the request's own tolerance. Every quote the leader stored must be found in the
  validator's own fetch of that source.

## Frontend

| Package | Version | Why this one |
|---|---|---|
| `next` | 16.3.5 | latest stable |
| `react`, `react-dom` | 19.3.0 | latest stable, inside Next's peer range |
| `genlayer-js` | 1.1.8 | latest stable (`2.0.0-rc.1` is a release candidate) |
| `typescript` | 6.0.3 | 7.0.2 is the native-compiler release: its package exports only `version.cjs`, without the compiler API that Next's type checker and typescript-eslint use; typescript-eslint's peer range is `<6.1.0`. 6.0.3 is the newest release both accept |
| `tailwindcss` | 4.3.3 | latest stable |
| `vitest` | 5.0.1 | latest stable |

genlayer-js 1.1.8 facts used by the app: `createClient({ chain, account, provider })` routes
`eth_sendTransaction` to the injected wallet's EIP-1193 provider; `readContract`, `writeContract`
(`value` as `bigint`), `getTransaction` (`statusName`). It has no `waitForFinalization`: the app polls
`getTransaction` and reports each status it actually observes.

## Python tooling

| Package | Version | Why |
|---|---|---|
| `genlayer-test` | 0.29.2 | latest |
| `genvm-linter` | 0.11.0 | latest |
| `genlayer-py` | 0.16.3 | 0.18.0 exists, but genlayer-test 0.29.2 requires `genlayer-py<0.17.0` |

On a cold cache `gltest` asks for the runner bundle under a name the v0.3.0-rc line renamed, so every
direct test fails at import while the linter passes. `scripts/fetch_genvm_bundle.py` seeds both
caches; CI runs it before the linter.
