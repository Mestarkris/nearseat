# NearSeat threat model

Status: **draft for approval. Written before any contract code.**
Date: 2026-11-08. Scope: testnet, test token (tUSDC) only, no real money.

## 1. What we are protecting

| Asset | Where it lives |
|---|---|
| Member money (tUSDC) | On the vault account `<seat>.nearseat.testnet` in the tUSDC ledger |
| Accrued but unsettled rewards | Per-token accounting in `nearseat.testnet` (keyed by **token**, never by person) |
| Match escrow (ticket sales, loan fees) | Per-match accounting in `nearseat.testnet` until full time or refund |
| Control of a vault | Whoever `nearseat.testnet` says owns the token at the moment of the call |
| Gate access for one match | Owner, or that match's renter, proven with a fresh NEP-413 proof |
| Reputation (attendance, goal stamps, tier) | Contract state, written only by gate/club roles under contract-checked rules |
| Inventory (passes, credits, vouchers) | Per-token state in `nearseat.testnet` |

## 2. Trust boundaries and roles

| Role | Can do | Cannot do |
|---|---|---|
| `nearseat.testnet` (main contract) | Mint memberships, create vaults, order vault payouts, run accounting | Hold keys after final deploy; upgrade itself (no upgrade method) |
| Vault (`<seat>.nearseat.testnet`) | Accept calls **only** from `nearseat.testnet`; send tUSDC where told | Hold access keys; change its code; obey anyone else |
| Club admin (`illiastars.testnet`) | Create fixtures, sell tickets, match events, top up pool, set fees **within hard-coded bounds** | Move vault money; transfer or burn memberships; change caps outside bounds; edit attendance |
| Gate scanner (`gate.illiastars.testnet`) | Call `check_in` for a holder it verified | Check in anyone the contract doesn't see as owner/renter; check in after full time |
| Relayer | Pay gas for NEP-366 delegate actions to an allow-list of contracts/methods | Forge user actions (every delegate action is user-signed with nonce + expiry) |
| Keeper | Trigger permissionless actions (auto-lend, refund batches) | Anything the contract doesn't re-check |
| Fans, renters, buyers, sponsors, public | Act through wallets | Bypass `nearseat.testnet` checks |

## 3. Design decisions this model depends on

1. **Ownership is never cached.** Every vault-affecting method reads `owner_id` from the NEP-171 token map in the same receipt where it decides. The vault itself has no notion of an owner: it trusts only `predecessor_account_id == nearseat.testnet`.
2. **Money follows the token, not the person.** Rewards, loan fees and refunds owed to a membership are credited to `token_id`. They settle into the vault, so the holder at withdrawal time receives them.
3. **Every outflow bumps a state nonce and marks itself in-flight.** `buy` needs the buyer's `expected_nonce` and zero outflows in flight.
4. **Vault code is a global contract deployed by hash, not by account.** A global contract deployed *by account* can be replaced by the deployer later. Deploying *by hash* can't be changed, and Verify checks that hash.
5. **Pull fallback for every push.** If a transfer to a person fails (unregistered account, panic), the callback credits `claimable[account]` instead of losing funds.
6. **Gate pass uses one signature per match plus a session key.** A wallet popup every 30 s is unusable, so:
   - The holder signs **one** NEP-413 message: `{token_id, match_id, session_pubkey, expires_at}`, recipient `nearseat-gate`, with a random 32-byte nonce.
   - The browser keeps the session private key in memory only and signs `{token_id, match_id, ts}` every 30 s. That signed payload is the QR.
   - The scanner checks: the NEP-413 signature; that the signing key is a full-access key of the holder (`view_access_key`); that the holder is the **live** owner or renter for this match; `ts` within 30 s; and that the session key signed the payload. Then the gate role calls `check_in`, and the contract checks everything again.
7. **Scope.** Layer 1 is mandatory. Layer 2 plan: auto-lend, then advance, then voting. **Shared tickets and sponsor drops start on the Roadmap.** A fractional token isn't NEP-171 and would need its own share standard. Their threats are listed (§4.9) so the design stays compatible if time allows.

## 4. Threats

Legend: **[AL]** = shown in the Attack Lab with a "Try it on testnet" button. Test names are planned paths under `contracts/*/tests` (sandbox) or `#[cfg(test)]` (unit).

### 4.1 Keys, approvals, upgrades

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T1 [AL] | Leftover access key on a vault | Vault created with a key; old owner signs directly from the vault | Vault created with `CreateAccount + Transfer + UseGlobalContract(hash)` only, never `AddKey`. Vault code has no key-management method. Verify shows `view_access_key_list = []` | `sandbox::vault::vault_has_zero_keys`, `sandbox::vault::vault_rejects_non_parent_caller` |
| T2 [AL] | Stale NEP-178 approval | Seller approves a marketplace, sells via `buy`, approved account later calls `nft_transfer` | Every owner change (transfer, buy, payout transfer) clears all approvals for that token. `approval_id` is checked on approved transfers | `sandbox::resale::approvals_cleared_on_sale`, `unit::approval_id_mismatch_rejected` |
| T3 | Swappable vault code | Global contract deployed by account ID, deployer replaces it with a draining version | Deploy vault code by **hash** (immutable). The main contract stores the hash; Verify compares the vault's `code_hash` to the published reproducible build | `sandbox::vault::vault_code_hash_matches_global` |
| T4 | Main contract upgraded to steal | Holder of `nearseat.testnet` full-access key redeploys | No upgrade method. After final deploy, delete all full-access keys (`near account delete-keys`). README shows how to check key list and code hash | Manual check `scripts/verify.sh` + README steps |
| T5 [AL] | Outsider calls vault directly | `seat-c5-12.nearseat.testnet.pay({to: attacker})` | Vault asserts `predecessor == parent` on every method except views | `sandbox::vault::vault_rejects_non_parent_caller` |

### 4.2 Resale and transfer

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T6 [AL] | Seller drains between listing and sale | List at 100, buyer inspects balance 80, seller withdraws 80, buyer completes | `list` freezes the vault: withdraw, lend, advance and auto-lend rules are refused while listed | `sandbox::resale::withdraw_blocked_while_listed` |
| T7 [AL] | Stale-state purchase | Seller delists, withdraws, relists at the same price; buyer's tx lands on changed state | Every outflow and every (de)list bumps `state_nonce`. `buy` requires `expected_nonce == state_nonce`; on mismatch the full tUSDC amount is refunded via `ft_on_transfer` return value | `sandbox::resale::wrong_nonce_refunds_buyer` |
| T8 [AL] | Sale during an in-flight withdrawal | Seller calls `withdraw`; receipt to vault in flight; `buy` lands before the callback | `withdraw` marks `outflows_in_flight += 1` before the cross-contract call. `buy` refuses while it is > 0. The callback decrements and, on failure, restores the balance without bumping ownership | `sandbox::resale::buy_rejected_during_inflight_withdraw` |
| T9 [AL] | Sale during an in-flight **settlement** (inflow) | Pool settles 5 tUSDC into the vault; seller sells before it lands; seller expects to keep it | Inflows are credited to the token. Whoever owns the token when the transfer lands owns it, and the inflow callback never pays a person. Buyer can withdraw it | `sandbox::resale::sale_mid_payout_buyer_receives_settlement` **(brief requirement)** |
| T10 | Failed settlement callback loses funds | `ft_transfer` to vault fails (vault unregistered in token, token panics) | Settlement subtracts `accrued[token]` optimistically, callback `#[private]` checks `PromiseResult`; on failure re-adds the amount and emits `settle_failed`. Enough gas reserved for the callback | `sandbox::settlement::failed_callback_restores_accrued` (uses failing FT mock) |
| T11 | Seller gets paid twice / buyer pays and gets nothing | Seller payout `ft_transfer` fails after ownership moved | Ownership change and accounting happen in one receipt in `ft_on_transfer`. Seller payout is a separate transfer; on failure it goes to `claimable[seller]`. Buyer is never at risk once ownership moved | `sandbox::resale::seller_payout_failure_goes_to_claimable` |
| T12 [AL] | Old owner keeps access after sale | Old owner reuses gated page session, cached QR, or calls `withdraw` | All three re-read live ownership: gated API calls `nft_token` per request; scanner checks live owner; contract checks owner in `withdraw`. Session certificates name the holder, so a cert from the old owner fails the live check | `sandbox::resale::old_owner_cannot_withdraw_lend_or_check_in`, `relayer` test `gated_rejects_previous_owner` |
| T13 [AL] | Tout overprices a membership | List a membership at 10× face | `list` and `nft_transfer_payout` reject price > `resale_cap_bps × season_price` | `sandbox::resale::price_above_cap_rejected` |
| T14 | Royalty bypass via plain `nft_transfer` | Seller and buyer settle off-chain, then plain transfer | Accepted residual: gifts must stay possible. Plain transfer is **blocked** while listed, while an advance is open, or while outflows are in flight, so it can't escape those obligations | `sandbox::transfer::plain_transfer_blocked_with_open_advance` |
| T15 | Marketplace payout exceeds balance or skips advance | `nft_transfer_payout` with a payout that ignores the debt | *Revised during build:* external marketplaces may pay in NEAR, but the advance is owed in tUSDC, so `nft_payout` / `nft_transfer_payout` **refuse** while an advance is open. The built-in market (tUSDC) repays the advance first, then royalty, then seller. Price cap and `max_len_payout` are enforced | `unit::advance_repaid_on_sale`, `unit::plain_transfer_blocked_with_open_advance` |

### 4.3 Revenue share and settlement

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T16 | Late joiner claims past rewards | Mint or buy right after a big payout and claim old rewards | Reward-per-share accumulator with per-token `reward_debt` set at mint. Buying a token inherits its accrued rewards, which is the intended "money follows the token" behaviour | `unit::new_mint_gets_no_past_rewards` |
| T17 | Rounding drains pool | Many tiny distributions round up | `acc_per_share` uses 1e24 scaling with floor division. Dust stays in pool. Invariant: Σ settled ≤ Σ distributed | `unit::accumulator_never_over_distributes` (property-style loop) |
| T18 | Overflow | Large values overflow u128 math | `overflow-checks = true` in release profile, checked math in accumulator | `unit::accumulator_large_values` |
| T19 | Club skips the members' cut | Club finalises a match without paying members | Cut is applied by the contract at `full_time`, not by a club transfer. `members_cut_bps` has a hard floor (≥ 1%) and ceiling | `sandbox::matchday::full_time_moves_cut_to_pool` |

### 4.4 Refunds and ticketing

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T20 [AL] | Club keeps money after postponing | Postpone a match and never refund | `postpone` flips state and opens refunds. `process_refunds(match, limit)` is **permissionless** (keeper or anyone). Each match has its own escrow, so one match's refunds can't use another's money | `sandbox::refunds::postpone_refunds_all_tickets` |
| T21 | Refund DoS by an unregistered buyer | One failing transfer blocks the batch | Each refund has its own callback; failure goes to `claimable[buyer]`, and the batch continues | `sandbox::refunds::failed_refund_goes_to_claimable` |
| T22 | Double refund | Call `process_refunds` twice | Ticket is marked `Refunded` before the transfer and restored to `RefundOwed` only on callback failure | `sandbox::refunds::no_double_refund` |
| T23 [AL] | Selling a member's seat without consent | Club sells seat C5-12 for match 2 although the member didn't lend it | Seat sale checks: seat not owned by a membership, **or** an active loan exists for (match, seat). Otherwise rejected | `sandbox::tickets::cannot_sell_unlent_member_seat` |
| T24 [AL] | Tout bulk-buys single tickets | One account buys 50 seats | Per-account cap per match (default 4). Single-match tickets are non-transferable (soulbound to buyer; `nft_transfer` panics for ticket tokens). Sybil accounts remain a residual risk, documented | `sandbox::tickets::per_account_cap`, `unit::ticket_nft_transfer_rejected` |
| T25 | Double sale of a seat | Two buyers race the same seat | Seat state is checked and set in the same receipt as payment acceptance. Loser's tUSDC is returned via `ft_on_transfer` return value | `sandbox::tickets::second_buyer_refunded` |

### 4.5 Lending

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T26 [AL] | Double-lending | Lend the same seat twice for one match | `loans[(match, token)]` unique. `lend` rejects if it exists, if the member already checked in, or after kickoff | `sandbox::lending::double_lend_rejected` |
| T27 [AL] | Renter uses the pass after the loan | Renter scans at a later match, or after full time | Gate validity requires `(match, token)` loan to the scanning holder **and** match status `Scheduled`/`Live`. `full_time` and `postpone` end loans | `sandbox::lending::renter_locked_out_after_full_time` |
| T28 [AL] | Owner and renter both enter | Owner scans too while lent | When a loan exists, only the renter is a valid holder for that match. Owner's pass is refused | `sandbox::lending::owner_refused_while_lent` |
| T29 | Lend above cap | Member rents at 10× | `price ≤ lend_cap(match)` enforced in `lend` and in auto-lend rule creation **and** execution | `sandbox::lending::lend_price_cap` |
| T30 | Loan fee stolen on sale | Fee paid, membership sold before full time | Fee goes to token accrual (not seller). Renter keeps that match's pass. Future-match loans don't exist (one match per loan) | `sandbox::lending::loan_survives_sale_fee_stays_with_token` |

### 4.6 Gate, attendance and stamps

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T31 [AL] | Screenshot / replayed QR | Photo of yesterday's QR or a 2-minute-old one | QR payload has `ts`; scanner rejects > 30 s skew. `check_in` is idempotent per `(match, token)` | `web` unit test `gatepass_rejects_stale_ts`, `sandbox::gate::second_check_in_rejected` |
| T32 [AL] | Forged session certificate | Attacker signs a cert with their own key for someone else's token | Scanner checks NEP-413 signature, that the key is a **full-access** key of the named holder, and that the holder is live owner/renter | `relayer` test `cert_signed_by_non_holder_rejected` |
| T33 [AL] | Fake attendance | Fan calls `check_in` themselves | `check_in` is callable only by the gate role, and only for live owner/renter, only while match `Scheduled`/`Live` | `sandbox::gate::non_gate_cannot_check_in` |
| T34 [AL] | Fake goal stamps | Anyone calls `goal`, or stamps land on members not present | `goal` is club-only, only while `Live`. Stamps go only to tokens in that match's checked-in set | `sandbox::matchday::goal_stamps_only_checked_in` **(brief requirement)** |
| T35 | Compromised gate key | Stolen scanner key checks in absent holders | Residual. The contract still checks the holder is the live owner/renter. The gate key is rotatable by the club. All check-ins are public NEP-297 events | Documented residual |
| T36 | Tier inflation via sale-and-buy-back | Wash trades to farm tiers | Attendance is per token and needs a gate check-in. Trading doesn't add attendance | `unit::tier_only_from_attendance` |

### 4.7 Matchday and club powers

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T37 | Out-of-order events | `goal` before `kickoff`, `full_time` twice | Strict state machine `Scheduled → Live → Finished`, `Scheduled/Live → Postponed`; anything else panics | `unit::match_state_machine` |
| T38 | Club admin abuse | Club raises fees to 100%, lowers members' cut to 0, mints to self | Fee and cap setters are clamped to hard-coded bounds in code. Club can't touch vault funds or transfer tokens. Mint supply is fixed per season (seeded 10 for demo, max set at init). All admin calls emit events | `unit::admin_setters_clamped`, `unit::club_cannot_transfer_member_token` |
| T39 | Lend after kickoff to farm fees | Lend once the match is underway | `kickoff` locks new loans and auto-lend execution | `sandbox::matchday::kickoff_locks_loans` |
| T40 | Forged events in the live feed | Another contract logs a fake `EVENT_JSON` | Frontend accepts events only from receipts whose `executor_id == nearseat.testnet` | `web` unit test `feed_ignores_foreign_executor` |

### 4.8 Layer 2 (advance, auto-lend, voting)

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T41 [AL] | Borrow-then-sell escape | Take an advance, then sell or gift the membership | Plain transfer is blocked while an advance is open. `buy` pays the advance from the sale price first, in the same receipt, before the seller's share | `sandbox::advance::advance_repaid_on_sale` **(brief requirement)** |
| T42 | Borrow-then-withdraw | Advance, then drain vault | Withdrawals blocked while the advance is open. Every payout repays the advance first | `sandbox::advance::withdraw_blocked_with_open_advance` |
| T43 | Over-borrow | Borrow more than expected earnings | Cap = 50% of expected remaining-season share, and ≤ available fund liquidity | `unit::advance_cap` |
| T44 | Unpaid advance at season end | Holder never repays | `close_season` recovers outstanding debt from the vault (contract-ordered transfer) | `sandbox::advance::season_end_recovery` |
| T45 [AL] | Double vote via sale | Vote, sell, buyer votes again with the same token | Votes are keyed `(poll, token_id)`, not by account | `sandbox::voting::double_vote_blocked_after_sale` **(brief requirement)** |
| T46 | Attendance farming after poll opens | Attend after poll start to gain weight | Weight = check-ins at matches with kickoff before `poll.start` | `unit::vote_weight_snapshot` |
| T47 | Keeper lends a seat against the owner's will | Keeper fires auto-lend after owner checked in or changed rules | Contract re-checks every rule condition at execution: rule exists, owner unchanged since rule creation, not checked in, before kickoff, within window, price ≤ cap. Rules cleared on any owner change | `sandbox::autolend::rule_cleared_on_sale`, `sandbox::autolend::recheck_conditions` |

### 4.9 Roadmap features (threats recorded so the design stays compatible)

| # | Threat | Mitigation if shipped |
|---|---|---|
| T48 | Share-sale race: share sold while its income is settling | Per-share accrual keyed by share token. Same in-flight counter and nonce as memberships |
| T49 | Co-owner grabs another's slot | Slot swap needs both shares' owners' signatures in one call. Gate checks slot holder for that match only |
| T50 | Sponsor spams vouchers / drains a vault | Sponsors are allow-listed by club. Drops only add items; redeem is once, at gate, by live holder |

### 4.10 Off-chain components

| # | Threat | Attack path | Mitigation | Proving test |
|---|---|---|---|---|
| T51 | Relayer drained for gas | Spam delegate actions | Allow-list receivers (`nearseat`, `tusdc`) and methods; per-account rate limit; daily gas budget; reject delegate actions with deposit > 1 yocto | `relayer` test `rejects_non_allowlisted_receiver` |
| T52 | Relayer forges user actions | Malicious relayer | Not possible. Delegate actions are signed by the user and include nonce + `max_block_height` | Protocol property; noted in README |
| T53 | Client-side-only gate | User edits JS to show the members-only page | Members-only content is served by an API that checks NEP-413 + live `nft_token` owner per request, and single-use nonces | `relayer` test `gated_requires_fresh_nonce` |
| T54 | NEP-413 replay on gated API | Reuse a captured signed message | Server stores used nonces until expiry; recipient must equal `nearseat-members`; message carries `issued_at` (≤ 5 min) | `relayer` test `gated_replay_rejected` |
| T55 | XSS through on-chain SVG | Renter account ID or sponsor name injected into SVG | All strings XML-escaped on-chain before SVG output; frontend renders SVG as `<img src=data:…>`, never `innerHTML` | `unit::svg_escapes_strings` |
| T56 | Secrets in repo | Keys committed | `.env.example` only; `.gitignore` for `.env`, `neardev/`, credentials; CI secret scan (gitleaks) | CI job |

## 5. Residual risks we accept (stated in README)

- Sybil touts across many accounts (T24) and compromised gate scanner keys (T35).
- After keys are removed, bugs can't be patched; a fix means a new deployment.
- Testnet RPC availability; the frontend shows error states rather than stale data.
- tUSDC is a valueless test token with an open faucet.

## 6. Attack Lab entries (≥ 12)

T1, T2, T5, T6, T7, T8, T9, T12, T13, T20, T23, T24, T26, T27, T28, T31, T32, T33, T34, T41, T45. These are 21 attacks across seller, previous owner, renter, tout, outsider and co-owner/club. Co-owner attacks move to the lab only if shared tickets ship.
