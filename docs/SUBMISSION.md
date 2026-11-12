# Submission kit

## Demo video

The demo is a 2:34 motion video at 60 fps with a voiceover and captions. It follows one seat: it gets its account, earns on matchday, is lent for a match, is sold with everything in it, and the old owner is refused at the gate. The narration script is kept with the video files, outside this repository.

## X post

> Your seat now earns. 🏟️
>
> NearSeat turns a football season ticket into an NFT that owns its own @NEARProtocol account: it earns 5% of every ticket sold, lends your seat, refunds itself and opens the gate. Sell it and everything moves to the buyer. The old owner is locked out.
>
> Keyless vaults · NEP-171 · stablecoin payouts · gasless fans
>
> Built at NEAR HACKATHON #NEARHackathon
> https://github.com/Mestarkris/nearseat · https://nearseat.vercel.app

## Project description (about 1,400 characters)

NearSeat runs a football club's whole season on NEAR, shown with the fictional Nigerian club Illia Stars United. Every season membership is an NEP-171 NFT that owns a keyless NEAR account (for example `seat-c5-12.nearseat.testnet`). The account earns: 5% of every match's ticket sales is split by seat category and settled into it, and it collects rent when the member lends the seat for one match. The holder pays club-approved vendors from it, saves towards next season, and opens the gate with a pass that expires in 30 seconds.

The account has zero keys and obeys only the NFT contract, which checks the live owner on every call. Sell the NFT and the money, passes, record and gate access move in one transaction, and the seller is refused from that block on. A sale works even in the middle of a payout. Listing freezes the account and buyers pin a state nonce, so a seller can't empty it first.

Clubs get stablecoin ticketing with per-match escrow, automatic refunds on postponement, capped resale with a royalty, gasless fans, and CSV books an accountant can open.

Every claim can be checked: 96 unit tests and 15 sandbox tests run in CI on every push, the Verify page compares the live code hash with the repository, the Attack Lab sends 21 attacks to testnet, and the threat model (67 threats) was the first commit. It runs on testnet with a test stablecoin.
