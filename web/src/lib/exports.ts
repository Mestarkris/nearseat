// The two accounting exports: one seat's ledger, and the club's payments.
// Every row is read from the contract at the moment of the download.
import { view } from "../near/rpc";
import { config, SYM } from "../config";
import { downloadCsv, money, utc, type Cell } from "./csv";
import { CATEGORIES, categoryOf } from "./category";
import { parseSeat } from "./format";
import type { HistoryEntry, Match, Membership, Season } from "./types";

const today = () => new Date().toISOString().slice(0, 10);
const seatName = (seat: string) => { const s = parseSeat(seat); return `${s.stand} stand, row ${s.row}, seat ${s.number}`; };

/** What each history entry means, and which way money moved in the seat's account. */
const ENTRY: Record<string, { text: string; dir: "in" | "out" | "note"; who?: string }> = {
  minted: { text: "Membership created", dir: "note", who: "First holder" },
  bought_from_club: { text: "Membership bought from the club (paid from the buyer's wallet)", dir: "note", who: "Buyer" },
  settled: { text: "Payout received: share of ticket sales and lending income", dir: "in" },
  withdrawn: { text: "Withdrawal to the holder's wallet", dir: "out", who: "Paid to" },
  paid_vendor: { text: "Payment to a club-approved vendor at the ground", dir: "out", who: "Paid to" },
  advance_recovered: { text: "Advance repaid from the seat account", dir: "out" },
  advance_taken: { text: "Advance on future payouts (paid to the holder's wallet)", dir: "note", who: "Paid to" },
  advance_repaid: { text: "Advance repaid out of a payout, before it reached the seat account", dir: "note" },
  rented: { text: "Seat lent for one match: income after the club fee, included in the next payout", dir: "note", who: "Renter" },
  lend_offered: { text: "Seat offered for one match at this price", dir: "note", who: "Offered only to" },
  loan_refunded: { text: "Match postponed: the renter was refunded", dir: "note", who: "Refunded to" },
  listed: { text: "Membership listed for sale at this price", dir: "note" },
  delisted: { text: "Sale listing removed", dir: "note" },
  sale_price: { text: "Membership sold at this price (paid by the buyer to the seller)", dir: "note", who: "Seller" },
  checked_in: { text: "Checked in at the gate", dir: "note", who: "Person admitted" },
  sold: { text: "Membership sold: the seat and its account moved to the buyer", dir: "note", who: "New holder" },
  transfer: { text: "Membership transferred to a new holder", dir: "note", who: "New holder" },
  returned: { text: "Transfer refused by the receiver: membership returned", dir: "note", who: "Holder" },
  voted: { text: "Vote cast in a club poll", dir: "note" },
  credits_spent: { text: "Food credits used", dir: "note", who: "Used by" },
};
/** Kinds whose `amount` is a count, not money. */
const NOT_MONEY = new Set(["voted", "credits_spent"]);

async function allHistory(tokenId: string, len: number): Promise<HistoryEntry[]> {
  const out: HistoryEntry[] = [];
  for (let from = 0; from < len; from += 200) out.push(...await view<HistoryEntry[]>("history", { token_id: tokenId, from_index: from, limit: 200 }));
  return out;
}

export async function downloadSeatLedger(m: Membership, matches: Match[], season: Season): Promise<number> {
  const history = await allHistory(m.token_id, m.history_len);
  const vs = new Map(matches.map((x) => [x.id, `v ${x.opponent}`]));
  const header = ["Date and time (UTC)", "What happened", "Money in", "Money out", "Amount for information only", "Currency", "Other party", "Other party is", "Match", "Seat", "Seat account", "Season", "Check on the public ledger"];
  const rows: Cell[][] = history.map((e) => {
    const k = ENTRY[e.kind] ?? { text: e.kind.replace(/_/g, " "), dir: "note" as const };
    const amount = e.amount != null && !NOT_MONEY.has(e.kind) ? money(e.amount) : "";
    return [
      utc(e.at), k.text,
      k.dir === "in" ? amount : "", k.dir === "out" ? amount : "", k.dir === "note" ? amount : "",
      amount === "" ? "" : SYM, e.account ?? "", e.account ? k.who ?? "" : "",
      e.match_id != null ? vs.get(e.match_id) ?? `Match ${e.match_id}` : "",
      seatName(m.seat), m.vault, season.name, `${config.explorer}/address/${m.vault}`,
    ];
  });
  downloadCsv(`nearseat-${m.token_id}-ledger-${today()}.csv`, header, rows);
  return rows.length;
}

interface Payment { payer: string; amount: string; kind: { Ticket?: { seat: string; ticket_id: string }; Rental?: { seat: string; token_id: string } }; status: "Paid" | "Refunding" | "Refunded" | "RefundClaimable" }
const STATUS: Record<Payment["status"], string> = {
  Paid: "Paid",
  Refunding: "Pending refund",
  Refunded: "Refunded",
  RefundClaimable: "Refund waiting for the payer to collect",
};

/** One row per payment the contract has taken for a match: ticket sales and seat rentals. */
export async function downloadClubPayments(matches: Match[], season: Season): Promise<number> {
  const jobs = matches.flatMap((x) => Array.from({ length: x.payment_count }, (_, index) => ({ x, index })));
  const rows: Cell[][] = [];
  for (let i = 0; i < jobs.length; i += 8) {
    const batch = await Promise.all(jobs.slice(i, i + 8).map(async ({ x, index }) => ({ x, index, p: await view<Payment | null>("payment", { match_id: x.id, index }) })));
    for (const { x, index, p } of batch) {
      if (!p) continue;
      const rental = p.kind.Rental;
      const seat = (rental ?? p.kind.Ticket)!.seat;
      const fee = rental ? (BigInt(p.amount) * BigInt(season.config.lend_club_fee_bps)) / 10_000n : null;
      rows.push([
        `${x.id}-${index + 1}`, utc(x.kickoff_at), `v ${x.opponent}`, x.competition, x.status,
        rental ? "Seat rented from a member" : "Match ticket", seatName(seat), CATEGORIES[categoryOf(seat)].label,
        p.payer, money(p.amount), SYM, STATUS[p.status],
        rental ? money(fee) : money(p.amount), rental ? money(BigInt(p.amount) - fee!) : "",
        rental ? rental.token_id : "", `${config.explorer}/address/${config.contractId}`,
      ]);
    }
  }
  const header = ["Payment reference", "Match date (UTC)", "Match", "Competition", "Match status", "Payment for", "Seat", "Seat category", "Paid by", "Amount", "Currency", "Payment status", "Club's part", "Member's part (seat rentals)", "Member's seat", "Check on the public ledger"];
  downloadCsv(`nearseat-club-payments-${today()}.csv`, header, rows);
  return rows.length;
}

/** One row per fixture: what was taken, what went to members, what was refunded. */
export function downloadFixtureSummary(matches: Match[], season: Season): number {
  const cut = BigInt(season.config.members_cut_bps);
  const header = ["Match date (UTC)", "Match", "Competition", "Status", "Standard ticket price", "Tickets sold", "Seats rented from members", "Members checked in", "Ticket sales", "Paid to members' accounts", "Club fees from seat rentals", "Payments taken", "Payments refunded", "Currency", "Score"];
  const rows: Cell[][] = matches.map((x) => {
    const sales = x.status === "Finished" && cut > 0n ? (BigInt(x.members_cut) * 10_000n) / cut : BigInt(x.escrow);
    return [
      utc(x.kickoff_at), `v ${x.opponent}`, x.competition, x.status, money(x.ticket_price), x.tickets_sold, x.seats_rented, x.members_checked_in,
      money(sales), x.status === "Finished" ? money(x.members_cut) : 0, money(x.rental_fees), x.payment_count, x.refunds_done, SYM,
      x.status === "Finished" || x.status === "Live" ? `${x.home_goals}-${x.away_goals}` : "",
    ];
  });
  downloadCsv(`nearseat-fixtures-${today()}.csv`, header, rows);
  return rows.length;
}
