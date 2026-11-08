// Mirrors the contract's JSON views (contracts/nearseat/src/views.rs).
export type Tier = "Bronze" | "Silver" | "Gold" | "Legend";
export type MatchStatus = "Scheduled" | "Live" | "Finished" | "Postponed";

export interface Goal { side: "Home" | "Away"; scorer: string; minute: number; at: string }

export interface Match {
  id: number;
  opponent: string;
  competition: string;
  kickoff_at: string;
  status: MatchStatus;
  started_at: string | null;
  ended_at: string | null;
  home_goals: number;
  away_goals: number;
  goals: Goal[];
  ticket_price: string;
  big_match: boolean;
  tickets_sold: number;
  seats_rented: number;
  members_checked_in: number;
  escrow: string;
  members_cut: string;
  payment_count: number;
  refunds_done: number;
}

export type Loan =
  | { Offered: { price: string; to: string | null; offered_by: string } }
  | { Rented: { price: string; renter: string } };

export interface Membership {
  token_id: string;
  seat: string;
  vault: string;
  owner_id: string;
  tier: Tier;
  attended: number[];
  goal_stamps: { match_id: number; opponent: string; scorer: string; minute: number }[];
  vault_balance: string;
  unsettled: string;
  pending_loan_income: string;
  debt: string;
  nonce: string;
  listing: { price: string; listed_at: string } | null;
  outflows_in_flight: number;
  passes_left: number;
  food_credits: number;
  holders: [string, string][];
  totals: {
    pool_earned: string; loan_income: string; settled_into_vault: string; withdrawn: string;
    advances_taken: string; advances_repaid: string; loan_refunds: string;
  };
  loans: { match_id: number; loan: Loan }[];
  autolend_rules: { match_id: number; hours_before: number; price: string; owner: string }[];
  history_len: number;
}

export interface Season {
  name: string; contract: string; club: string; gate: string; stablecoin: string;
  vault_code_hash: string; season_price: string; resale_cap: string; max_supply: number;
  memberships: number; pool_total_distributed: string; club_balance: string; advance_fund: string;
  payout_round: number; round_settled: number;
  config: { members_cut_bps: number; lend_club_fee_bps: number; lend_cap_bps: number; resale_fee_bps: number;
    resale_cap_bps: number; max_tickets_per_account: number; tier_thresholds: [number, number, number];
    advance_cap_bps: number; expected_share_per_match: string };
}

export interface HistoryEntry { at: string; kind: string; amount: string | null; account: string | null; match_id: number | null }
export interface FeedItem { seq: string; at: string; event: string; data: string }
export interface SeatView { seat: string; state: "sold" | "rented" | "lent" | "member" | "member_in"; price: string | null; token_id: string | null; holder: string | null }
export interface Poll { id: number; question: string; options: string[]; tallies: number[]; starts_at: string; ends_at: string; voters: number }
export interface TicketInfo { match_id: number; seat: string; buyer: string; payment_index: number }
