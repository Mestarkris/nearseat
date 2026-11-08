# NearSeat architecture

## Accounts (testnet)

| Account | What runs there | Keys after final deploy |
|---|---|---|
| `nearseat.testnet` | Main contract: NEP-171 memberships + single-match tickets, pool, matchday, market, gate | **None** (deleted; see README "Verify") |
| `seat-<stand><row>-<n>.nearseat.testnet` | One per membership. Vault code (global contract, by hash) | **None, ever** (created without `AddKey`) |
| `tusdc.nearseat.testnet` | tUSDC test token (NEP-141 + NEP-145, open faucet) | Deployer key (it's a test token) |
| `illiastars.testnet` | The club: fixtures, matchday control, top-ups | Club's wallet |
| `gate.illiastars.testnet` | Gate scanner: `check_in` | Scanner device key (rotatable by club) |
| relayer account | Pays gas for NEP-366 delegate actions | Relayer server |

`nearseat.testnet` must be the parent of the vaults: on NEAR only the parent
account can create `x.nearseat.testnet`.

## Contracts

```
contracts/
  vault/     ~60 lines. Stateless. pay(token, receiver, amount) — parent-only.
  nearseat/  main contract (modules below)
  tusdc/     NEP-141 test token
  mock-ft/   TEST ONLY token that fails transfers on demand
```

`nearseat` modules: `membership` (mint + NEP-171/177/178/181), `money` (pool,
settlement, withdrawals, callbacks), `payments` (`ft_on_transfer` router),
`matchday`, `lending`, `market` (resale + NEP-199), `gate`, `views`, `svg`,
`events`, and Layer 2 `advance`, `autolend`, `voting`.

## How control passes on transfer

1. The vault obeys one account: `nearseat.testnet` (`predecessor == parent`).
2. `nearseat.testnet` acts on a vault only inside a method that first reads the
   token's **current** `owner_id` from NEP-171 state, in the same receipt.
3. So whoever the NFT ledger says owns `seat-c5-12` *is* the only person who can
   move `seat-c5-12.nearseat.testnet`'s money. Changing the NFT owner changes
   vault control atomically: there is nothing else to hand over.
4. Money owed but not yet in the vault (pool share, loan income) is keyed by
   token, so it moves too. Inventory (credits, stamps, attendance) is token state.

## Data flow: ticket sale → revenue share → settlement → sale mid-settlement → buyer withdraws

```mermaid
sequenceDiagram
    autonumber
    actor Fan as Ticket buyer
    participant T as tusdc
    participant N as nearseat
    participant V as seat-c5-12 vault
    actor A as Alice (seller)
    actor B as Bob (buyer)
    actor K as Keeper

    Fan->>T: ft_transfer_call(nearseat, 15, BuySeat{match 1, a1-1})
    T->>N: ft_on_transfer
    N->>N: escrow[match 1] += 15, mint soulbound ticket
    Note over N: Club: kickoff → full_time(1)
    N->>N: cut = 5% of escrow → acc_per_share += cut / supply
    K->>N: settle_batch()
    N->>T: ft_transfer(vault, owed)  [credit for seat-c5-12 = 0]
    Note over T,N: transfer receipt in flight
    A->>N: list(seat-c5-12, 200)  [nonce++ , vault frozen]
    B->>T: ft_transfer_call(nearseat, 200, BuyMembership{seat-c5-12, nonce})
    T->>N: ft_on_transfer → checks nonce, nothing in flight
    N->>N: owner = Bob (approvals, offers, rules cleared)
    N->>T: ft_transfer(Alice, 200 − 5% royalty − advance)
    T-->>N: on_settled(seat-c5-12, owed) ✓
    N->>N: vault_balance[seat-c5-12] += owed (token, not person)
    B->>N: withdraw(seat-c5-12, owed) [1 yocto, owner check = Bob ✓]
    N->>V: pay(tusdc, Bob, owed)
    V->>T: ft_transfer(Bob, owed)
    T-->>N: on_withdrawn ✓
    A-->>N: withdraw(seat-c5-12) ✗ "only the current holder"
```

## Matchday: kickoff → goal → full time → payout

```mermaid
sequenceDiagram
    autonumber
    actor C as Club (Matchday control)
    participant N as nearseat
    actor G as Gate scanner
    actor K as Keeper
    participant UI as Frontends (poll RPC 3–5 s)

    G->>N: check_in(seat-c5-12, match 1, alice)  [live owner/renter re-checked]
    C->>N: kickoff(1)
    N-->>UI: event kickoff (loans + sales locked, minute = now − started_at)
    C->>N: goal(1, Home, "Okafor")
    N-->>UI: event goal (stamp for members checked in before this goal)
    C->>N: full_time(1)
    N->>N: status Finished → renters' passes dead, rental income released to tokens
    N->>N: 5% of escrow → pool, rest + rental fees → club, payout_round++
    N-->>UI: event full_time (payout round opens)
    loop until round_settled == supply
        K->>N: settle_batch(8)
        N-->>UI: events settled (payout progress bar)
    end
```

## Off-chain pieces

- **web/**: React + Vite. Reads with plain RPC `view` calls every 3–5 s
  (`get_feed`, `get_match`, `membership`); writes through Wallet Selector or
  the relayer (NEP-366).
- **relayer/**: Express. `/relay` submits user-signed delegate actions to an
  allow-list of receivers and methods. `/members` serves the members-only page
  after an NEP-413 proof and a live `nft_token` owner check. `/gate/verify`
  verifies gate-pass QR payloads.
- **keeper/**: Node script. `settle_batch`, `process_refunds`,
  `execute_autolend`, and `demo-match` for the seeded end-to-end run.
