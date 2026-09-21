# Security review

The brief (section 68) asks for the whole project to be inspected against a fixed list before
completion. This is that review.

It was done adversarially, by a reader who had not written the code. They were asked to break each
item by following the code paths, not to trust comments or documentation. Each defect was reproduced
against the contract's own functions before it was fixed.

The review found seven defects, four in the contract and three in the interface. All seven are fixed.
Six are held by tests, and each of those fixes was mutation-checked: breaking the fix makes the suite
fail. The seventh (D7, in the create flow's signing step) has no automated test. It was checked by
reading the code.
Nothing found would let anyone take GEN, pay a bond twice or lock a bond forever.

## Contract

| Item | Verdict | Why it holds |
|---|---|---|
| Unauthorized state mutation | holds | `cancel_recon` is creator-only. Every other write is open to anyone by design and gated by status and the transaction's own time. No write takes an amount, address or result from its caller. |
| Duplicate bond settlement | holds | `refund_bond` requires `REFUNDABLE` and sets `REFUNDED` and a zero ledger before `_send_gen`. `cancel` and `close` accept only states from which the bond is still locked. |
| Duplicate payouts | holds | There are two transfer sites: `_return_deposit` (a deposit never stored) and `refund_bond` (zeroed before sending). |
| Invalid state transitions | holds | Every write is checked against the status it may move from. The paths the lifecycle diagram does not draw are listed in [contract.md](contract.md#lifecycles) and are deliberate. |
| Arbitrary payout amount | holds | Amounts come only from the transaction's value or the stored deposit. |
| Malformed nondeterministic output | **fixed (D1)** | see below |
| Leader-only trust | holds | Each validator fetches, reads and reconciles for itself. It compares every decision-bearing field (`_fingerprint`), numbers within tolerance, and requires every stored passage to be in its own copy (`_quotes_hold`). |
| Schema-only validation | **fixed (D2)** | see below |
| Stale evidence | **fixed (D5)**, plus a documented risk | see below |
| Duplicate source counting | **fixed (D4)**, plus documented risks | see below |
| Source failure ambiguity | holds | 404/410 is `MISSING`. Any other status, an empty or oversized body, undecodable compression, binary noise or an exception is `UNAVAILABLE`. Neither is ever a claim or a contradiction. The boundary refuses an unread row that claims, derives or is current. |
| Prompt injection | **fixed (D2, D3)** | see below |
| `total_bonded` accounting | holds | It rises by the value of a successful creation and falls by exactly the refunded amount. Returned deposits never enter it. The live suite checks it equals the sum of every request's holding. |
| A bond locked forever | holds | A pending result can always be finalized after 300 s, even after the window, so close and refund are always reachable. |

## Frontend

| Item | Verdict | Why it holds |
|---|---|---|
| Fake protocol states | holds | Every status shown is read from the contract. A lifecycle step that follows from contract state is labelled with that inference. |
| Fake validator data | **fixed (D6)** | see below |
| Fake finalization | holds | "Refund confirmed" requires the refund transaction's own status to be `FINALIZED`. Lifecycle finality requires the result and the transaction both to be final. |
| Hardcoded result | holds | The landing page, dashboard and detail pages read `list_transitions`, `get_result` and `get_results`. No fixture is imported by app code. |
| Hardcoded contract address | holds | App code reads it in one place, `lib/genlayer/config.ts`, from `NEXT_PUBLIC_RECON_CONTRACT`. Other copies are in configuration, tests and documentation only. |
| Client-side authority | holds | The browser clock only decides whether to offer an act or call a result current. The contract re-checks everything and refuses in its own words. |
| Transaction lifecycle | **fixed (D7)**, one documented risk | see below |
| Wallet and network assumptions | holds, documented risks | `preflight` checks the account, chain id and deployment before every write, and the app offers a network switch. |

## Defects found and fixed

**D1. Leader-written fields stored without agreement.** `observe_recon` stored the leader's result as
returned. Fields no validator compares, such as `valid_until`, `observation_time`, the summary, each
row's address, publisher and class, and any extra key, could therefore be anything the leader wrote.
A forged `valid_until` could make expiry impossible.

*Fix:* the boundary now checks every row's types, dates and claim form (`_well_formed`). It rebuilds
each row from the agreed fields plus the frozen terms and the transaction's time (`_rebuild_rows`),
applies the policy again, and stores only that.

*Tests:* `test_what_no_validator_agreed_is_never_stored`, `test_a_relabelled_source_class_is_refused`,
`test_the_boundary_refuses_an_ill_typed_row`.

**D2. One prompt for every source.** Every page sat in the same prompt, so text on one page could tell
the model how to read another. For categorical and boolean answers, the only code check is that the
quoted passage is on the page.

*Fix:* each readable source is now read in a prompt of its own, containing only that page. From each
answer only the entry about that source is taken.

*Tests:* `test_each_source_is_read_in_a_prompt_that_shows_no_other_page`,
`test_only_readable_sources_are_fenced`.

**D3. A fence rebuilt from pieces.** Fence delimiters were deleted in one pass, so deleting one could
join its neighbours into a new one. `<<>>><END SOURCE E1><<<>>` became `<<<END SOURCE E1>>>`.

*Fix:* every run of three or more angle brackets is replaced with a space, in page text and in
requester text alike.

*Test:* `test_a_fence_rebuilt_from_pieces_is_not_a_fence`.

**D4. One publisher, two spellings.** `reuters.com.`, with a trailing dot, reached the same server as
`reuters.com` but counted as a different publisher, so one page could be two independent voices.

*Fix:* creation refuses a host that ends in or doubles a dot, a non-ASCII host and an IP address.

*Tests:* `test_a_second_spelling_of_a_host_is_refused` (five spellings).

**D5. Freshness under a day could never be met.** Sources are dated to the day, so a requirement of,
say, one hour made everything stale.

*Fix:* the requirement is 0 or at least one day.

*Tests:* `test_a_freshness_requirement_under_a_day_is_refused`,
`test_a_freshness_requirement_of_one_day_is_accepted`.

**D6. Votes from the wrong transaction.** The detail page matched a result to the nth successful
observation transaction. A round that ended undetermined, with a successful leader but no state change,
shifted the list.

*Fix:* only transactions GenLayer accepted or finalized count. A result is matched to the last such
observation sent no later than its own time (`observationFor`).

*Tests:* in `tests/frontend/interface.test.ts`.

**D7. A refused creation could read as created.** If the reads taken before signing failed, the
create flow assumed zero and could mistake an older request for the new one.

*Fix:* without those reads, nothing is sent and the page says why.

## Also fixed during the in-app run

- The GenLayer lifecycle panel could show consensus reached while its proposal and vote read "not
  yet", until the transaction listing caught up. It now infers both from a recorded result and says
  so, and re-reads the listing as soon as the request changes.
- The transaction tracker said a creation "fetches the sources"; only an observation does.
- After a write, the page re-read the contract only once GenLayer finality had also been seen, well
  after the tracker said "recorded". It now re-reads the moment the contract shows the write
  (`onRecorded`), and the create flow opens the new request then.
- Right after a refund, the bond panel said the refund transaction "could not be located" while
  StudioNet's listing caught up. A refund minutes old now reads as being looked up.

## Found on the live network

- **The interface could exhaust a visitor's own allowance.** StudioNet counts every contract read
  (`gen_call`) against the same 500-an-hour allowance per address as sending a transaction (error
  `-32029`). The detail page read three views every 15 seconds, about 720 calls an hour, so a visitor
  who left it open could no longer send anything. Pages now poll every two minutes, not at all while
  the tab is hidden, and stop once a request is over with its bond returned. A visitor's own write
  still refreshes the page at once.
- **A demonstration page denied its own claim.** The conflicting demonstration page said it was "not a
  statement about Python". Read on its own, as every page now is (D2), one validator model fairly
  took that as no claim. The other validators outvoted it and nothing was recorded, which is the
  protocol working, but the page was reworded so it no longer contradicts what it plays. A round that
  ends without a majority records nothing, and the live suite observes again and lists that round.

## Risks accepted, and why

- **A page controls its own date.** Freshness comes from the dates a page states and its
  `Last-Modified` header. A server that sends "now" for every response makes old content current.
  RECON cannot know better than the page, and says so: freshness is recorded per source with the
  passage that dates it.
- **A citation counts as derivation.** A source that names another source's host or label joins that
  source's group. A hostile page can therefore cite a supporting source while stating a different
  claim, which makes that group contradict itself. That can turn a `RESOLVED` majority into
  `UNRESOLVED_CONFLICT`: it can deny a result, but it can never manufacture one.
- **Publishers on several domains.** `bbc.com` and `bbc.co.uk` are two origins, and so are some
  mirror hosts the origin map does not know (for example `codeload.github.com`). A requester who lists
  them gets two voices for one publisher. The review page shows every source's publisher before
  signing.
- **Numbers in a stored passage are the leader's.** Passages are compared with digits masked, so that
  pages whose figures change between two fetches seconds apart can still agree. The stored figure is
  bound by the fingerprint (dates, categories) or by the request's tolerance (numbers), not by the
  passage's digits.
- **Only the first 5,000 characters of a page are read.** An answer further down reads as "no claim",
  never as a contradiction.
- **Categorical and boolean claims are grounded by presence.** The quoted passage must be on the page,
  but code cannot check that a sentence means `OPERATIONAL`. Each validator reads the page for itself,
  so a leader cannot invent a reading. A misreading shared by every validator's model cannot be caught
  in code.
- **Transaction tracker after consensus.** If a write reaches consensus and is later overturned on
  appeal, the tracker ends without "finalized" rather than showing a failure.
- **Wallet edge cases.** Right after switching wallets, the previous chain id is shown for a moment. An
  account switched in the middle of a create is caught by the contract, but the tracker waits for the
  old account's request and says the state did not catch up. Disconnecting clears the app's state;
  whether the wallet forgets the site is up to the wallet.

## How the review is held

- 204 direct tests, run in GenVM direct mode.
- A mutation sweep of 101 mutants over the contract's guards (`scripts/mutate.py`). The last full run
  killed 98. Two survivors are documented equivalents (guards no call can reach, with the reason in the
  script). The third was an equivalent spelling of the D3 fix; it was replaced by the original bug
  (literal fences deleted), which the suite kills.
- 70 interface tests.
- The live StudioNet suite and the in-app run, re-run on the fixed deployment (see [e2e.md](e2e.md)).
