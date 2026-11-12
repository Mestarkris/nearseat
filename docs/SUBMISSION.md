# Submission kit

## Demo video

The demo is a 2:34 motion video at 60 fps with a voiceover and captions. It follows one seat: it gets its account, earns on matchday, is lent for a match, is sold with everything in it, and the old owner is refused at the gate. The narration script is kept with the video files, outside this repository.

## X post

Main post (269 of 280 characters, with the demo video attached):

> Season tickets earn their holders nothing.
>
> NearSeat makes each membership an NFT that owns a keyless @NEARProtocol account. It earns 5% of every match's ticket sales. Sell it and the money goes with it; the seller is locked out.
>
> Built at NEAR HACKATHON #NEARHackathon

Reply to it:

> Try it with test money, no install: https://nearseat.vercel.app
> Code, tests and the attacks it refuses: https://github.com/Mestarkris/nearseat
>
> If you run a club or a supporters' group: what would you want a membership to pay for?

## Where to submit

Once, at https://nearhackathon.com/#apply (or its API), tracks `nfts` and `realworld`, after the X post is up. Mistakes are fixed at https://nearhackathon.com/request-changes, never by submitting again.

## Project description (about 1,400 characters)

NearSeat runs a football club's whole season on NEAR, shown with the fictional Nigerian club Illia Stars United. Every season membership is an NEP-171 NFT that owns a keyless NEAR account (for example `seat-c5-12.nearseat.testnet`). The account earns: 5% of every match's ticket sales is split by seat category and settled into it, and it collects rent when the member lends the seat for one match. The holder pays club-approved vendors from it, saves towards next season, and opens the gate with a pass that expires in 30 seconds.

The account has zero keys and obeys only the NFT contract, which checks the live owner on every call. Sell the NFT and the money, passes, record and gate access move in one transaction, and the seller is refused from that block on. A sale works even in the middle of a payout. Listing freezes the account and buyers pin a state nonce, so a seller can't empty it first.

Clubs get stablecoin ticketing with per-match escrow, automatic refunds on postponement, capped resale with a royalty, gasless fans, and CSV books an accountant can open.

Every claim can be checked: 96 unit tests and 15 sandbox tests run in CI on every push, the Verify page compares the live code hash with the repository, the Attack Lab sends 21 attacks to testnet, and the threat model (67 threats) was the first commit. It runs on testnet with a test stablecoin.
