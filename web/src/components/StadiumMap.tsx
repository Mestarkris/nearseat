// Flat Stars Arena map: 4 stands × 6 rows × 15 seats = 360 seats.
// Seats not returned by `seat_map` are on sale by the club, coloured by their
// category. Row 1 of every stand is the row nearest the pitch.
import type { SeatView } from "../lib/types";
import { CATEGORIES, CATEGORY_ORDER, categoryOf, multiple } from "../lib/category";

export const STANDS = [
  { code: "a", name: "North Stand" },
  { code: "b", name: "East Stand" },
  { code: "c", name: "South Stand" },
  { code: "d", name: "West Stand" },
] as const;
export const ROWS = 6;
export const SEATS_PER_ROW = 15;

type State = SeatView["state"] | "available";

const COLOR: Record<State, string> = {
  available: "hover:brightness-125",
  lent: "bg-lime hover:brightness-110",
  member: "bg-sky/80",
  member_in: "bg-sky",
  sold: "bg-[#1b2026]",
  rented: "bg-[#1b2026]",
};

const LABEL: Record<State, string> = {
  available: "Available",
  lent: "Lent by a member",
  member: "Member seat",
  member_in: "Member attending",
  sold: "Sold",
  rented: "Rented",
};

function Block({ code, name, seats, picked, onPick, vertical, far }: {
  code: string; name: string; seats: Map<string, SeatView>; picked?: string;
  onPick: (seat: string, view?: SeatView) => void; vertical?: boolean;
  /** Stand is drawn above or left of the pitch, so its row 1 goes last. */
  far?: boolean;
}) {
  const rows = Array.from({ length: ROWS }, (_, r) => (far ? ROWS - r : r + 1));
  const nums = Array.from({ length: SEATS_PER_ROW }, (_, n) => n + 1);
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="label">{name}</div>
      <div
        className={`grid gap-[3px] ${vertical ? "grid-flow-col" : ""}`}
        style={vertical ? { gridTemplateRows: `repeat(${SEATS_PER_ROW}, minmax(0, 1fr))` } : { gridTemplateColumns: `repeat(${SEATS_PER_ROW}, minmax(0, 1fr))` }}
      >
        {rows.flatMap((r) =>
          nums.map((n) => {
            const id = `${code}${r}-${n}`;
            const v = seats.get(id);
            const state: State = v?.state ?? "available";
            const clickable = state === "available" || state === "lent";
            const isPicked = picked === id;
            return (
              <button
                key={id}
                type="button"
                disabled={!clickable}
                onClick={() => onPick(id, v)}
                aria-label={`${name}, row ${r}, seat ${n}, ${CATEGORIES[categoryOf(id)].label}: ${LABEL[state]}`}
                aria-pressed={isPicked}
                className={`size-[14px] rounded-[3px] sm:size-4 ${isPicked ? "bg-white ring-2 ring-lime" : state === "available" ? `${CATEGORIES[categoryOf(id)].swatch} ${COLOR.available}` : COLOR[state]}`}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

export function StadiumMap({ seats, picked, onPick }: { seats: SeatView[]; picked?: string; onPick: (seat: string, view?: SeatView) => void }) {
  const byId = new Map(seats.map((s) => [s.seat, s]));
  const [n, e, s, w] = STANDS;
  return (
    <div className="overflow-x-auto">
      <div className="mx-auto flex w-max flex-col items-center gap-3 p-2">
        <Block {...n} seats={byId} picked={picked} onPick={onPick} far />
        <div className="flex items-center gap-3">
          <Block {...w} seats={byId} picked={picked} onPick={onPick} vertical far />
          <div className="relative h-[240px] w-[260px] overflow-hidden rounded-xl border border-white/20 sm:w-[340px]" aria-hidden>
            <div className="pitch absolute inset-0" />
            <div className="absolute inset-3 rounded border border-white/40" />
            <div className="absolute inset-y-3 left-1/2 border-l border-white/40" />
            <div className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
          </div>
          <Block {...e} seats={byId} picked={picked} onPick={onPick} vertical />
        </div>
        <Block {...s} seats={byId} picked={picked} onPick={onPick} />
      </div>
      <ul className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-muted">
        {CATEGORY_ORDER.map((c) => (
          <li key={c} className="flex items-center gap-2"><span className={`size-3 rounded-sm ${CATEGORIES[c].swatch}`} />{CATEGORIES[c].label} <span className="text-white/50">{multiple(c)}</span></li>
        ))}
        {(["lent", "member_in", "sold"] as State[]).map((st) => (
          <li key={st} className="flex items-center gap-2"><span className={`size-3 rounded-sm ${COLOR[st]}`} />{LABEL[st]}</li>
        ))}
        <li className="flex items-center gap-2"><span className="size-3 rounded-sm bg-white" />Your pick</li>
      </ul>
    </div>
  );
}

export function standName(seat: string): string {
  return STANDS.find((s) => s.code === seat[0])?.name ?? "";
}
