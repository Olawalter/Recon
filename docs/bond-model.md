# The bond

Every RECON request carries a GEN bond. It is an economic commitment attached to the request, so that
making a request costs something: it discourages spam, meaningless requests and automated flooding.

It is **not** a bet, a stake on the answer, a validator vote, a reward for being right, a governance
token, a second party's escrow or anything a model scores. The reconciliation never reads it: the
bond is not in the prompt, not in the policy, and not in any field validators compare. A test creates
two identical requests with bonds ten thousand times apart and requires identical results.

## Terms and ledger

| Field | Meaning |
|---|---|
| `bond_required` | the economic term, fixed at creation |
| `bond_deposited` | what the contract holds for this request right now; the only amount any refund reads |
| `bond_status` | `LOCKED`, `REFUNDABLE` or `REFUNDED` |

The deposited amount is `gl.message.value`, the value of the creating transaction. A caller-supplied
number is never trusted as a deposit: `bond_required` must equal the value sent, and the value is what
is recorded.

## Lifecycle

```text
create_recon (value = bond)            LOCKED       held while the request can be observed
   │
   ├── cancel_recon (creator, before any observation) ──► REFUNDABLE
   │
   └── close_recon (anyone, after the observation window) ─► REFUNDABLE
                                                               │
                                             refund_bond (anyone) ──► REFUNDED   GEN sent to the creator
```

There is no forfeiture path. The brief asks for no subjective slashing, and no deterministic rule for
forfeiting a bond would be fair to a requester whose sources simply disagreed: the bond deters spam by
locking capital for the request's lifetime, and is always returned in full.

## The settlement invariant

`refund_bond` follows the order the brief requires, with no exception:

```text
read bond_deposited  →  require it > 0  →  set bond_deposited = 0 and status REFUNDED
                     →  persist  →  emit the GEN transfer to the recorded creator
```

- The amount comes from stored state, never from an argument.
- The recipient is the recorded creator, who was the signer of the creating transaction. Anyone may
  send the refund; the GEN goes only to the creator.
- A second refund fails: the status is no longer `REFUNDABLE`, and even without that check the
  ledger is already zero. A direct test spies on the transfer and confirms the ledger reads zero at
  the moment it is emitted.
- All GEN leaves through one helper, `_send_gen`, which refuses a missing recipient and a zero amount.

## Emitted and confirmed

GenLayer's `emit_transfer` defaults to `on='finalized'`: the transfer message is sent when the refund
transaction becomes final, not when it is accepted. So:

| The interface says | When |
|---|---|
| **Refund emitted** | contract state shows `REFUNDED` (the refund transaction was accepted) |
| **Refund confirmed** | the refund transaction's own GenLayer status is `FINALIZED`, so the transfer has been sent |
| **Refund confirmation unavailable** | the refund transaction could not be located on StudioNet; contract state still shows the refund was emitted |

## Deposits the contract cannot accept

StudioNet credits the value of a payable transaction that reverts to the contract. A creation that
fails validation after GEN was attached therefore does not revert: it creates nothing, sends the value
straight back in the same transaction, and records the refusal and its reason in `returned_deposits`
(readable per sender through `returned_for`). A creation with no value at all is refused outright,
since nothing is at stake.

## Accounting

`get_protocol_info.total_bonded` is the sum of every bond currently held. It rises on creation and
falls on refund by exactly the refunded amount. The live suite checks conservation: after its refunds,
`total_bonded` equals the sum of `bond_deposited` across every request on the contract.
