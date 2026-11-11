// Flat Stars Arena map: 4 stands × 6 rows × 15 seats = 360 seats.
// Seats not returned by `seat_map` are on sale by the club, coloured by their
// category. Row 1 of every stand is the row nearest the pitch.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SeatView } from "../lib/types";
import { reduced } from "../lib/motion";
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
  lent: "bg-wine hover:brightness-110",
  member: "bg-sky/80",
  member_in: "bg-sky",
  sold: "bg-[#2a1f24]",
  rented: "bg-[#2a1f24]",
};

/** Something that just happened on the pitch. A new `id` plays it again. */
export interface MapEffect { kind: "wave" | "payout"; id: number }

// Where a seat sits on a clockwise lap of the ground (0 to 1), starting at the
// north-west corner. A goal wave uses it as its delay.
const STAND_INDEX: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
function lap(code: string, n: number): number {
  const along = code === "a" || code === "b" ? n - 1 : SEATS_PER_ROW - n;
  return (STAND_INDEX[code] + along / SEATS_PER_ROW) / 4;
}
const COIN_SIZE = { Vip: 15, Pitchside: 12, Standard: 9, FansEnd: 8 } as const;

const LABEL: Record<State, string> = {
  available: "Available",
  lent: "Lent by a member",
  member: "Member seat",
  member_in: "Member attending",
  sold: "Sold",
  rented: "Rented",
};

function Block({ code, name, seats, picked, onPick, onMember, readOnly, vertical, far }: {
  code: string; name: string; seats: Map<string, SeatView>; picked?: string;
  onPick: (seat: string, view?: SeatView) => void; vertical?: boolean;
  onMember?: (tokenId: string, el: HTMLElement) => void; readOnly?: boolean;
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
            const buyable = !readOnly && (state === "available" || state === "lent");
            // A member's seat opens its membership card where the page allows it.
            const tokenId = v && v.state !== "sold" ? v.token_id ?? `seat-${id}` : undefined;
            const opens = !buyable && !!onMember && !!tokenId;
            const isPicked = picked === id;
            return (
              <button
                key={id}
                type="button"
                disabled={!buyable && !opens}
                onClick={(e) => (opens ? onMember!(tokenId!, e.currentTarget) : onPick(id, v))}
                aria-label={`${name}, row ${r}, seat ${n}, ${CATEGORIES[categoryOf(id)].label}: ${LABEL[state]}${opens ? ". Opens the membership card" : ""}`}
                aria-pressed={opens ? undefined : isPicked}
                data-member={tokenId ? categoryOf(id) : undefined}
                style={{ "--wd": `${Math.round(lap(code, n) * 1500 + r * 25)}ms` } as CSSProperties}
                className={`seat size-[14px] rounded-[3px] sm:size-4 ${opens ? "hover:ring-2 hover:ring-white/70 " : ""}${isPicked ? "bg-white ring-2 ring-lime" : state === "available" ? `${CATEGORIES[categoryOf(id)].swatch} ${COLOR.available}` : COLOR[state]}`}
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

export function StadiumMap({ seats, picked, onPick, onMember, readOnly, effect }: {
  seats: SeatView[]; picked?: string; onPick: (seat: string, view?: SeatView) => void;
  /** Given, member seats become buttons that open that membership. */
  onMember?: (tokenId: string, el: HTMLElement) => void;
  /** Nothing is on sale (a finished match): free seats can't be picked. */
  readOnly?: boolean;
  effect?: MapEffect;
}) {
  const byId = new Map(seats.map((s) => [s.seat, s]));
  const [n, e, s, w] = STANDS;
  const stage = useRef<HTMLDivElement>(null);
  const pitch = useRef<HTMLDivElement>(null);
  const [waving, setWaving] = useState(false);

  useEffect(() => {
    if (!effect || reduced()) return;
    if (effect.kind === "wave") {
      // Drop the class for a frame so a second goal restarts the wave.
      setWaving(false);
      const raf = requestAnimationFrame(() => setWaving(true));
      const t = setTimeout(() => setWaving(false), 2400);
      return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }
    const root = stage.current, centre = pitch.current;
    if (!root || !centre) return;
    const box = root.getBoundingClientRect();
    const c = centre.getBoundingClientRect();
    const from = { x: c.left + c.width / 2 - box.left, y: c.top + c.height / 2 - box.top };
    const coins: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>("[data-member]").forEach((seat, i) => {
      const r = seat.getBoundingClientRect();
      const size = COIN_SIZE[seat.dataset.member as keyof typeof COIN_SIZE] ?? 9;
      const to = { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
      const coin = document.createElement("span");
      coin.className = "payout-coin";
      coin.style.width = coin.style.height = `${size}px`;
      root.appendChild(coin);
      coins.push(coin);
      const at = (p: { x: number; y: number }, scale: number) => `translate(${p.x - size / 2}px, ${p.y - size / 2}px) scale(${scale})`;
      const flight = coin.animate(
        [{ transform: at(from, 0.4), opacity: 0 }, { transform: at(from, 1.3), opacity: 1, offset: 0.15 }, { transform: at(to, 1), opacity: 1, offset: 0.9 }, { transform: at(to, 0.5), opacity: 0 }],
        { duration: 1100, delay: i * 90, easing: "cubic-bezier(.5,0,.2,1)", fill: "both" },
      );
      flight.onfinish = () => {
        coin.remove();
        seat.animate([{ transform: "scale(1)" }, { transform: "scale(1.9)", boxShadow: "0 0 0 3px #ead9b5" }, { transform: "scale(1)" }], { duration: 520, easing: "ease-out" });
      };
    });
    return () => coins.forEach((coin) => coin.remove());
    // Only a new effect id should replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect?.id]);

  const block = { seats: byId, picked, onPick, onMember, readOnly };
  return (
    <div className="overflow-x-auto">
      <div ref={stage} className={`relative mx-auto flex w-max flex-col items-center gap-3 p-2 ${waving ? "map-wave" : ""}`}>
        <Block {...n} {...block} far />
        <div className="flex items-center gap-3">
          <Block {...w} {...block} vertical far />
          <div className="relative h-[240px] w-[260px] overflow-hidden rounded-xl border border-white/20 sm:w-[340px]" aria-hidden>
            <div className="pitch absolute inset-0" />
            <div className="absolute inset-3 rounded border border-white/40" />
            <div className="absolute inset-y-3 left-1/2 border-l border-white/40" />
            <div ref={pitch} className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40" />
          </div>
          <Block {...e} {...block} vertical />
        </div>
        <Block {...s} {...block} />
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
