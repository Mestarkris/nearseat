# Submission kit

## Demo video script (about 2:45)

Record in the browser at 1280×800, with a phone mirrored for the gate pass. Run `npm run demo` in a terminal you can cut to.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:15 | Landing page, live card | "This is NearSeat. Every season membership for Illia Stars United is an NFT that owns its own NEAR account. Your seat now earns." |
| 0:15–0:35 | `#/verify/seat-c5-12` → **Verify on-chain** | "The card's account is `seat-c5-12.nearseat.testnet`. Verify asks public RPC directly: zero access keys, and the code hash matches our published build. Only the NFT holder can move this money." |
| 0:35–0:55 | **Matches** → buy a grey seat; club dashboard pool grows | "A fan buys a ticket in tUSDC. Five percent of every ticket goes to the members' pool, live." |
| 0:55–1:10 | **My membership → Seat lending** → lend for one match; a second wallet buys the lime seat | "Can't make it? Lend your seat for one match. The renter pays, the renter gets the gate pass, and the fee goes into the seat's own account." |
| 1:10–1:40 | Club **Matchday control**: Kickoff → Goal → Full time. Member dashboard feed and payout bar | "Matchday is on-chain. Kickoff locks loans. A goal stamps every member who checked in. Full time ends loans and starts the payout: watch each seat account get settled." |
| 1:40–2:10 | Member lists the card; payout is running; buyer buys with the nonce; `#/verify` shows the new holder and the payout landing in the vault; old owner's withdraw fails | "Now the twist: sell mid-payout. The buyer pins the vault state they saw. NFT, balance, passes and gate access move in one transaction. The payout lands in the vault, so the buyer gets it, and the seller is locked out." |
| 2:10–2:30 | Phone: rotating gate pass; scanner says *Welcome in*; old screenshot says *Refused* | "At the gate, the pass rotates every five seconds and dies after thirty. Screenshots and old owners fail." |
| 2:30–2:45 | **Attack Lab** → **Try it on testnet** twice → refusals | "Twenty-one documented attacks, each with a test, and you can fire them at testnet yourself. NearSeat: your seat now earns." |

## X post

> Your seat now earns. 🏟️
>
> NearSeat turns a football season ticket into an NFT that owns its own @NEARProtocol account: it earns 5% of every ticket sold, lends your seat, refunds itself and opens the gate. Sell it and everything moves to the buyer. The old owner is locked out.
>
> Keyless vaults · NEP-171 · stablecoin payouts · gasless fans
>
> Built at NEAR HACKATHON #NEARHackathon
> https://github.com/Mestarkris/nearseat · https://nearseat.vercel.app

## Project description (about 1,250 characters)

NearSeat is a season membership and ticketing platform for football clubs, demoed with the fictional Nigerian club Illia Stars United. Every season membership is an NEP-171 NFT that owns its own keyless NEAR sub-account (for example `seat-c5-12.nearseat.testnet`). That account holds the member's stablecoin balance and collects 5% of every match's ticket sales through an O(1) reward-per-share pool. It also earns when the member lends their seat for a match, holds passes, credits and attendance and goal stamps, and opens the stadium gate with a 30-second rotating NEP-413 pass.

The vault has zero access keys and obeys only the NFT contract, which checks the live owner on every call. Selling the NFT therefore moves the money, inventory, record and access in one transaction, and the seller is locked out. Resale is seller-proof: listing freezes the vault, and buyers pin a state nonce. A sale even works mid-payout, because payouts are owed to the token, not the person.

Clubs get escrowed stablecoin ticketing, automatic refunds on postponement, capped resale with a NEP-199 royalty, and gasless fans via NEP-366. There is a public history and Verify page, an Attack Lab with 21 tested attacks, and the threat model was written before any code.
