<p align="center"><img src="web/public/brand/logo-dark-bg.svg#gh-dark-mode-only" alt="NearSeat" width="320"><img src="web/public/brand/logo-light-bg.svg#gh-light-mode-only" alt="NearSeat" width="320"></p>

# NearSeat: your seat now earns

**Season memberships that own their own NEAR accounts.** Built for the fictional Nigerian club **Illia Stars United**.

Every season membership is an NEP-171 NFT that owns a keyless NEAR sub-account, for example `seat-c5-12.nearseat.testnet`. That account:

- holds the member's tUSDC;
- collects its share of 5% of every match's single-ticket sales, weighted by seat category;
- earns when the member lends their seat;
- carries attendance and goal stamps;
- opens the stadium gate and the members-only page.

**Whoever holds the NFT controls the account.** Sell the NFT and the balance, inventory, record and access rights move to the buyer in one transaction. The seller keeps nothing.

**Live app:** https://nearseat.vercel.app (mirror: https://mestarkris.github.io/nearseat/) · **Contract:** [`nearseat.testnet`](https://testnet.nearblocks.io/address/nearseat.testnet) · **Example vault:** [`seat-c5-12.nearseat.testnet`](https://testnet.nearblocks.io/address/seat-c5-12.nearseat.testnet)

> Testnet only. **tUSDC is a valueless test token** with an open faucet. Illia Stars United, its players and its stadium are fictional.

## Tracks

| Track | What NearSeat shows |
|---|---|
| **NFTs That Do Something** (`nfts`): what comes after the JPEG | Each NFT owns a NEAR sub-account that holds money, earns income from ticket sales and seat rentals, holds inventory (passes, credits, stamps), carries credentials (attendance, tier) and grants access (gate, members-only page). The NFT card is dynamic SVG rendered from on-chain state. |
| **Real-World Money** (`realworld`): something a club could use tomorrow | Stablecoin (NEP-141) ticketing with per-match escrow, automatic refunds, revenue sharing settled into member accounts, capped resale with a club royalty (NEP-199), and gasless fan actions through an NEP-366 relayer. Every payment has a status (paid, pending refund, refunded) and the books export as CSV for an accountant. Prices can be quoted live from other chains through NEAR Intents (1Click). |

## Brief checklist

| Requirement | Where |
|---|---|
| NEP-171 contract + logic tying each token to its sub-account | [`contracts/nearseat/src/membership.rs`](contracts/nearseat/src/membership.rs), [`contracts/vault/src/lib.rs`](contracts/vault/src/lib.rs) |
| README: how control passes, what stops the old owner keeping access | [§ How control passes on transfer](#how-control-passes-on-transfer) |
| Gated page only current holders can open | `#/members` + relayer `POST /members` ([`relayer/src/server.mjs`](relayer/src/server.mjs)) |
| Per-NFT history: what it earned, paid out, who held it | `#/verify/<token>` + contract views `history`, `membership` |
| Tests for the transfer path, including a sale mid-payout | `sale_mid_payout_buyer_receives_settlement`: unit **and** sandbox tests |
| Threat model written before any code | [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). It is the first commit (`git log --reverse`). |

---

## Quickstart: do X, see Y

### A. Run the tests (no accounts, no NEAR needed)

Prerequisites: Rust (the pinned toolchain installs itself via `rust-toolchain.toml`), [`cargo-near`](https://github.com/near/cargo-near) 0.23+, and Node 22+.

```bash
git clone https://github.com/Mestarkris/nearseat && cd nearseat
npm install
npm run build:contracts      # → target/near/*/*.wasm + prints code hashes
npm run test:unit            # see: 83 Rust unit tests pass
npm run test:sandbox         # see: 15 end-to-end tests pass on a local NEAR sandbox
npm run test:js              # see: gate pass, NEP-413 and relayer policy tests pass
```

The first sandbox run downloads a NEAR sandbox node and compiles OpenSSL from source (vendored, so no system OpenSSL headers are needed). It takes a few minutes.

### B. Use the testnet deployment (just a browser)

The reference deployment lives at `nearseat.testnet`, and `.env.example` points at it. If you deployed your own copy (C), `npm run deploy` rewrites `.env` for you.

```bash
cp .env.example .env
npm run dev             # → http://localhost:5173
```

| Do | See |
|---|---|
| Open **Home** | The live `seat-c5-12` card, rendered from chain state |
| Open **Verify** (`#/verify/seat-c5-12`), press **Verify on-chain** | Live RPC results: **0 access keys** on the vault, vault code hash = the published hash, current owner, active loan |
| Scroll the same page | Every payout, rental, withdrawal and check-in, plus every past holder with dates. No wallet needed |
| **Connect wallet** (Meteor, HOT or MyNearWallet on testnet) → **Join**, then **Get 250 test tUSDC** | Free test tokens in your wallet |
| On **Join**, tap a grey seat → **Buy membership** (150 to 500 tUSDC, by seat category) | The contract creates `seat-<your seat>.nearseat.testnet` with **zero keys** and mints the membership NFT to you. **My membership** opens your new seat account |
| Tap a grey seat, press **Buy ticket** | The seat turns dark; the live feed shows `Ticket sold`; the fixture's members' pool grows by 5% |
| Tap up to four seats, press **Buy 4 tickets** | One wallet approval pays for all of them; each seat becomes its own ticket NFT. A fifth seat is refused: one wallet holds at most 4 tickets per match |
| Open **Matches** with a wallet that holds a membership | A note says your membership already gets you in, so tickets are only for guests |
| Press the sun or moon button in the header | The site switches between the light (beige and white) look and the dark one, and remembers the choice |
| Tap a **lime** seat (lent by a member), buy it | The ticket slip shows the money going to that member's seat account, minus a 5% club fee |
| **Attack Lab** → **Try it on testnet** on any card | A real transaction is sent and the contract refuses it, e.g. *"vault only obeys its parent contract"* |

### C. Deploy your own copy (about 20 testnet NEAR)

1. Create a testnet account yourself, for example with [MyNearWallet](https://testnet.mynearwallet.com), or with:
   ```bash
   near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
   ```
   Fund it to about 20 NEAR (two faucet requests). Its key must be in `~/.near-credentials/testnet/<you>.testnet.json`, or set `<YOU>_TESTNET_PRIVATE_KEY`.
2. Set `MASTER_ACCOUNT=<you>.testnet` in `.env`, then:

| Do | See |
|---|---|
| `npm run deploy` | Sub-accounts `tusdc`, `club`, `gate`, `relayer`, `fan01..fan10`; the vault deployed as a **global contract by hash**; NearSeat deployed on `<you>.testnet`; `.env` filled in |
| `MY_ACCOUNT=<your wallet>.testnet npm run seed` | 10 memberships (each with a keyless vault), 3 fixtures (Harbour City FC, Lagoon Athletic, Eko Rangers), funded fans, 50 tUSDC in the members' pool, a kit poll |
| `npm run verify` | ✅ for every vault: `keys=0`, `global_code=<hash>` = your local build |
| `npm run relayer` (one terminal) and `npm run keeper` (another) | Relayer on `:8787` (gasless relay, members-only API, gate scanning); keeper settling payouts, refunds and auto-lend. In production both run without a server: the relayer as Vercel functions under `/api`, the keeper as a GitHub Actions cron |
| `npm run dev`, open **My membership** with `MY_ACCOUNT`'s wallet | Your card, balance, inventory and the live match card |
| `npm run season-rule` | The season lending rule checked on the live contract: set, due list, keep one match, release it, permissionless execution. Ends with **Season auto-lend rule valid ✔** |
| `npm run club-check` | Every club action run once on a new fixture and checked on-chain: fixture, ticket sale, check-in, non-club refused, kickoff, goals, full time, payout round, pool top-up, poll, club withdrawal. Ends with **All club actions valid ✔** |
| `npm run demo` | A full match, live: tickets sold → a member lends a seat → check-ins → kickoff → goals → full time → payout bar fills as each vault is settled |
| **Pass** on your phone, **Scan** on another device | Green *Welcome in*, and attendance recorded on-chain. A screenshot shown 30 s later turns red |

---

## How control passes on transfer

1. **The vault has no keys.** `mint_membership` creates `seat-<seat>.<contract>` with exactly three actions: `CreateAccount`, `Transfer` (gas money for 1-yocto deposits) and `UseGlobalContract(hash)`. There is no `AddKey`, and the vault code has no method that adds one. Nobody, including the club, the deployer or the first owner, can sign as the vault.
2. **The vault obeys exactly one account: its parent.** Its only state-changing method, `pay`, checks `predecessor_account_id == <parent>`, where the parent is derived from its own account id ([`contracts/vault/src/lib.rs`](contracts/vault/src/lib.rs), 8 KB, `no_std`).
3. **The parent obeys only the current NFT owner.** Every vault-affecting method (`withdraw`, `lend`, `list`, `borrow`, `vote`…) reads `owner_id` from the NEP-171 token map **in the same receipt** it acts in (`assert_owner` in [`lib.rs`](contracts/nearseat/src/lib.rs)). There is no cached ownership anywhere.
4. **So transferring the NFT is transferring the account.** When `owner_id` changes, the previous owner's next call fails with `only the current holder can do this`. Nothing else needs handing over.
5. **Money follows the token, not the person.** Pool rewards and rental income are credited to the token id and settle *into the vault*. A payout that is in flight during a sale lands in the vault and belongs to the buyer (`sale_mid_payout_buyer_receives_settlement`).
6. **Every owner change runs the same hook** (`after_transfer`), whether it happens through `nft_transfer`, `nft_transfer_call`, `buy` or `nft_transfer_payout`. The hook:
   - clears NEP-178 approvals;
   - clears the listing, un-rented lend offers and auto-lend rules;
   - bumps the state nonce;
   - appends the new holder to the public holder history.

   Paid rentals survive: the renter keeps that one match.

### What stops the old owner keeping access

| Old owner tries… | Why it fails |
|---|---|
| Signing from the vault | It has no keys, and Verify shows `0` live. |
| Calling `withdraw` / `lend` / `list` | Live NEP-171 owner check, every call. |
| Using a stale NEP-178 approval | Approvals are cleared on every owner change. |
| Draining the vault between listing and sale | `list` freezes withdrawals, loans and advances. Any outflow or (de)list bumps a nonce, and `buy` reverts with a full refund if the nonce differs from what the buyer inspected. `buy` also refuses while a withdrawal is in flight. |
| Showing an old QR at the gate | A QR is valid for 30 s, and the scanner and contract check the live owner/renter at scan time. |
| Reopening the members-only page | Each load needs a fresh NEP-413 signature with a single-use nonce, and the relayer checks the live owner. |
| Taking an advance, then selling or gifting | Plain transfer is blocked while an advance is open. A sale repays it from the price first, in the same receipt. |
| Voting again via the buyer | Votes are keyed by `(poll, token)`. |

The full analysis (67 threats, mitigations and tests) is in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md). Diagrams are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Verify the code hash

NEAR reports `code_hash` = base58(sha256(wasm)).

```bash
npm run build:contracts            # prints the hash of every wasm you just built
npm run verify                     # compares them with what is live on testnet
```

Or by hand, with nothing but `curl`:

```bash
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"seat-c5-12.nearseat.testnet"}}'
# → "global_contract_hash": "<vault hash>"  (must equal the build output for nearseat_vault.wasm)
curl -s https://test.rpc.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"seat-c5-12.nearseat.testnet"}}'
# → "keys": []
```

The vault is deployed **by hash**, not by account. A global contract deployed by account can be replaced later by whoever controls that account; one deployed by hash cannot.

Before locking, `node scripts/redeploy.mjs --yes` can push new contract code while keeping all state (it checks that the state still reads correctly). When the stored layout changes, the deploy and its migration go in one transaction: `node scripts/migrate.mjs --yes` did this for the seat-categories upgrade and checks that every membership is still owed exactly what it was owed before.

After the final deploy, `node scripts/lock.mjs --yes-delete-all-keys` deletes every key on the NearSeat contract account. `npm run verify` then shows `access keys on contract: 0`. This is irreversible, so it is the very last step.

Builds are deterministic for a given toolchain. `rust-toolchain.toml` pins Rust 1.99.1 and `Cargo.lock` pins every crate. The `reproducible_build` metadata in `contracts/nearseat/Cargo.toml` is set up for a Docker-based `cargo near build reproducible-wasm`. The final image digest is filled in at release (see Known limits).

---

## Tests

| Command | What it proves |
|---|---|
| `npm run test:unit` | **87** NearSeat unit tests + 4 vault + 3 tUSDC. Includes: the season lending rule (waits for its window, never lends a checked-in holder's seat, cleared on sale, price follows the cap), paying a club-approved vendor from the seat (unapproved, listed, over-limit and failed payments), renewal saving (set aside, capped at the season price, cleared on sale), seat categories (prices, weighted split that never over-distributes, per-category caps, migration from the equal-split layout), sale mid-payout, failed-callback rollback (settle, withdraw, refunds), wrong nonce, old owner locked out, renter locked out after full time, price caps (lend + resale), goal stamps only for checked-in members, advance repaid on sale, double vote blocked, auto-lend cleared on sale, admin bounds |
| `npm run test:sandbox` | **15** end-to-end tests with real receipts, including: a seat paying a vendor in real tUSDC while its renewal savings stay locked; a VIP seat costing more and earning a bigger share; a fan buying a new membership from the club with tUSDC; vault keyless + global code hash + parent-only; full season on real tUSDC; **sale mid-payout with interleaved receipts**; failed settlement and withdrawal callbacks with a failing token; wrong nonce refunds buyer; renter + old owner locked out; goal stamps; postponement refunds; advance repaid on sale; double vote blocked |
| `npm run test:js` | Gate pass (fresh OK, screenshot > 30 s rejected, old owner rejected, forged cert rejected), members-only replay and non-holder rejection, relayer allow-list and rate limits |

---

## Repository

```
contracts/
  nearseat/        main contract (NEP-171/177/178/181/199 + NEP-297 events)
  vault/           keyless vault, no_std, 8 KB, global contract by hash
  tusdc/           valueless NEP-141 test token with faucet
  mock-ft/         TEST ONLY: token that fails transfers on demand + global deploy helper
  sandbox-tests/   near-workspaces end-to-end tests
shared/            NEP-413 + gate pass crypto (used by web, relayer, tests)
relayer/           NEP-366 relay, members-only API, gate scanning
keeper/            settles payouts, processes refunds, fires auto-lend; demo match
web/               React + Vite + Tailwind frontend
scripts/           build, deploy, seed, verify, lock
docs/              THREAT_MODEL.md, ARCHITECTURE.md, SUBMISSION.md
```

## Features

**Layer 1 (core), all built and tested.**
- Membership NFT owning a keyless vault, bought from the club with tUSDC (`#/join`) or second-hand on the market.
- **Seat categories.** VIP (2.5x), Pitchside (1.5x), Standard (1x) and Fans' End (0.75x), derived from the seat id, never stored. The category sets the membership price, the single-ticket price, the lend and resale caps, the advance cap and the seat's weight in the members' pool (10 / 6 / 4 / 3).
- Members' pool: an O(1) reward-per-weight accumulator with settlement into vaults and rollback callbacks.
- Single-match tickets (soulbound NEP-171) with per-match escrow, sold from a 360-seat map.
- **Several seats in one checkout.** A fan picks up to 4 seats for a match (`max_tickets_per_account`, set by the club) and approves once. Each seat is its own payment, so if one was just taken that payment alone is refunded and the app says which seats came through. A member does not need a ticket: the membership is the pass.
- Automatic refunds on postponement (permissionless batches; failures parked in `claimable`).
- Seat lending for one match, with a price cap and club fee.
- Seller-proof resale: freeze, nonce, NEP-199 royalty and price cap.
- Inventory: passes, food credits, attendance and goal stamps.
- Tiers that rise with attendance, plus a priority window for big matches.
- Dynamic on-chain SVG card.
- Rotating NEP-413 gate pass and scanner.
- Members-only page, public history, Verify, and the Attack Lab (21 attacks).
- Pay at the ground: the holder pays a club-approved vendor straight from the seat's account (`pay_vendor`). The club keeps the vendor list; nobody else can move the money.
- The seat pays for itself: the holder sets a share of each payout aside towards next season (`set_renewal_saving`). Money set aside can't be withdrawn or spent until the switch is turned down, and stops at the season price.
- Season statement: one shareable page per seat with everything it earned, spent and saved.
- **Books an accountant can open.** Three CSV downloads, built in the browser from contract views. See [For the bookkeeper](#for-the-bookkeeper).
- **Price from any chain.** On the ticket and membership screens, "Holding another token?" asks NEAR Intents (1Click API) what the price costs in SOL, BTC, ETH or USDC on another chain, live. It is a quote only on this testnet deployment (see Known limits).
- Live matchday (kickoff, goal, full time, postpone) with an on-chain event feed polled every 4 s.

**Layer 2.**
- ✅ **Auto-lend rules.** The keeper triggers them and the contract re-checks every condition. Rules are cleared on sale.
- ✅ **Lend every match I miss.** One rule for the whole season: before each home match, a seat whose holder has not checked in is offered at a share of the ticket price. It covers fixtures created after the rule was set. The holder can keep any single match, and taking a seat back stops the rule for that match.
- ✅ **Advance on future earnings.** Capped; repaid first from every payout and from a sale; withdrawals and transfers blocked while open; recovered at season end.
- ✅ **Member voting.** Weight is attendance snapshotted at poll start; one vote per membership per poll.
- 🗺 **Roadmap: shared season ticket.** Splitting one membership into N shares isn't NEP-171 compatible without a separate share-token standard. The threats are recorded (T48–T49) so the design can take it later.
- 🗺 **Roadmap: sponsor drops.** Tier-filtered vouchers into vaults, redeemed once at the gate (threat T50).

## For the bookkeeper

You don't need a wallet or any crypto knowledge to read these files. They open in Excel, Numbers or Google Sheets. Amounts are plain numbers in tUSDC (a test US dollar stablecoin, 1 tUSDC = 1 USD in this demo). Times are UTC.

| File | Where to get it | One row is | Columns |
|---|---|---|---|
| `nearseat-club-payments-<date>.csv` | Club page, "Payments CSV" | One payment received by the club for a match | Payment reference, Match date, Match, Competition, Match status, Payment for (ticket or seat rental), Seat, Seat category, Paid by, Amount, Currency, Payment status, Club's part, Member's part, Member's seat, Check on the public ledger |
| `nearseat-fixtures-<date>.csv` | Club page, "Fixtures CSV" | One fixture | Match date, Match, Competition, Status, Standard ticket price, Tickets sold, Seats rented from members, Members checked in, Ticket sales, Paid to members' accounts, Club fees from seat rentals, Payments taken, Payments refunded, Currency, Score |
| `nearseat-<seat>-ledger-<date>.csv` | A seat's season statement, "Download for your accountant (CSV)" | One event in the life of one membership | Date and time, What happened, Money in, Money out, Amount for information only, Currency, Other party, Other party is, Match, Seat, Seat account, Season, Check on the public ledger |

**Payment status** is one of four words:

- **Paid**: the money was received and the match went ahead or is still scheduled.
- **Pending refund**: the match was postponed and the refund is queued. It is sent automatically.
- **Refunded**: the money went back to the payer.
- **Refund waiting for the payer to collect**: the automatic refund could not be delivered (for example the payer closed their token account). The money is held for them, not for the club.

In the seat ledger, only "Money in" and "Money out" change the seat account's balance. "Amount for information only" is for rows such as a sale price, which is paid to the seller and not to the seat account, so adding the first two columns always reconciles to the balance. The last column of every file is a link to the public ledger where the account can be checked independently.

## Known limits

- **Paying from another chain is a quote, not a payment, on testnet.** NEAR Intents and the 1Click API run on mainnet only, and this deployment takes a test stablecoin. The app asks 1Click for a dry quote (no deposit address is created, no funds can move). On mainnet the flow is: the fan sends SOL, BTC or another token to the 1Click deposit address, USDC arrives in their NEAR account, and the purchase is one gasless tap. Some routes have no market maker at a given moment; the app shows that plainly and offers another token.
- **CSV rows link to accounts, not to single transactions.** The contract keeps its own history but not transaction hashes, so "Check on the public ledger" opens the account's page on the explorer.

- **Guest tickets stay with the buyer.** Single tickets are non-transferable, so a fan who buys four holds four gate passes in one wallet and brings the guests in. Assigning a ticket to a guest's own wallet is on the roadmap.
- **Paying for several seats at once is not gasless.** The relayer carries one payment at a time, so a basket of two or more seats is sent as normal transactions (well under a cent of testnet NEAR).
- **The NFT picture keeps the dark club colours** in both site themes, because it is drawn by the contract.
- **Gasless relaying needs a wallet that signs NEP-366 delegate actions.** When the wallet can't, the app falls back to a normal transaction, which costs the fan a fraction of a cent of testnet NEAR. 1-yocto deposits always come from the fan's own account.
- **The gate scanner key lives in the relayer** (the club's server). A stolen scanner key still can't admit a non-holder, because the contract re-checks, but it could record attendance for absent holders (T35). The club can rotate it with `set_gate`.
- **Sybil touts** across many accounts are only limited per account (T24).
- **Serverless relayer (Vercel).** The rate limiter and single-use NEP-413 nonce store live in memory per function instance, so a replay could slip through if it lands on a different instance within the 5-minute window. The live owner check still applies on every request. A shared store (e.g. Vercel KV) closes this. The keeper runs as a GitHub Actions cron every 10 minutes.
- **No upgrade method by design.** After `lock`, a bug fix means a new deployment.
- **Reproducible build image digest** is pinned at release. Until then, compare hashes built locally with the pinned toolchain.

## Libraries and AI-generated code

Contracts: `near-sdk` 5.30, `near-contract-standards` 5.30, `near-sys` 0.4, `near-workspaces` 0.24. Off-chain: `near-api-js` 7.4, `@near-wallet-selector/*` 10.1, `@noble/curves` and `@noble/hashes` 2.4, `express` 5, `react` 19, `vite` 8, `tailwindcss` 4, `qrcode`, `jsqr`.

**AI-generated code:** most of this repository (contracts, tests, relayer, keeper, scripts, frontend, and this documentation) was written with **Claude (Anthropic) via Claude Code**, working from the builder's brief and mockups. The builder directed the work, chose the scope and reviewed it.

## License

[MIT](LICENSE)
