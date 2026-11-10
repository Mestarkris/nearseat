// The animated story of one seat: it gets an account, earns on matchday, is
// lent for a match, then sold. One stage, four states. On wide screens the
// state follows the scroll position; on phones it plays on its own and the
// reader can tap a step.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useCountUp, useInView, useMedia } from "../lib/motion";
import { Crest } from "./ui";

const STEPS = [
  {
    title: "The seat gets its own account",
    body: "When Amaka joins, the contract creates an account for seat C5-12. No key or password exists for it. It answers to whoever holds the membership, and to nobody else.",
    note: "Created the moment the membership is minted",
    balance: 0,
  },
  {
    title: "Every matchday pays in",
    body: "At full time, 5% of that match's ticket sales is split between the members and paid into each seat's account. The holder can withdraw it at any time.",
    note: "Its share of tonight's ticket sales",
    balance: 12.5,
  },
  {
    title: "Can't make it? Lend the seat",
    body: "Amaka lends the seat to Tunde for one match. Tunde's wallet now shows the gate pass, and Amaka's is paused for that match, so one seat never lets two people in. Access returns to Amaka after full time.",
    note: "Tunde's rent for the match landed here",
    balance: 20.5,
  },
  {
    title: "Sell it and everything moves",
    body: "Chidi buys the membership on the market. The seat, its balance, match passes and attendance record arrive in one transaction. From that block on, Chidi's pass opens the gate and Amaka's is refused.",
    note: "Moved to Chidi together with the seat",
    balance: 20.5,
  },
] as const;

// Stand geometry: 5 curved rows of 13 seats.
const ROWS = 5, COLS = 13, OURS = { r: 2, c: 8 };
const seatX = (c: number) => 18 + c * 28.5;
const seatY = (r: number, c: number) => 14 + r * 30 + Math.pow(c - 6, 2) * 0.55;
const SEATS = Array.from({ length: ROWS * COLS }, (_, i) => ({ r: Math.floor(i / COLS), c: i % COLS, i }));
const sold = (r: number, c: number) => (r * 7 + c * 3) % 4 !== 0;
const COIN_SEATS = SEATS.filter((s) => sold(s.r, s.c) && (s.i * 5) % 7 === 0);

type PassState = "valid" | "paused" | "refused";
const PASS: Record<PassState, { text: string; gate: string; cls: string }> = {
  valid: { text: "Pass valid", gate: "Gate opens", cls: "text-lime border-lime/50" },
  paused: { text: "Pass paused", gate: "Lent for this match", cls: "text-warn border-warn/50" },
  refused: { text: "Pass refused", gate: "Gate stays shut", cls: "text-danger border-danger/50" },
};

function Holder({ name, role, pass, hidden = false }: { name: string; role: string; pass: PassState; hidden?: boolean }) {
  const p = PASS[pass];
  return (
    <div className={`story-fade rounded-2xl border border-line bg-card px-3 pb-3 pt-12 ${hidden ? "translate-y-2 opacity-0" : ""}`} aria-hidden={hidden}>
      <div className="font-display text-base font-bold">{name}</div>
      <div className="text-xs text-muted">{role}</div>
      <div className={`mt-2 flex items-center gap-2 rounded-xl border bg-ink px-2 py-1.5 transition-colors duration-500 ${p.cls}`}>
        <svg width="22" height="22" viewBox="0 0 9 9" aria-hidden className="shrink-0">
          {[0, 2, 6, 8, 4, 3, 7].map((n) => <rect key={n} x={(n % 3) * 3 + 0.4} y={Math.floor(n / 3) * 3 + 0.4} width="2.2" height="2.2" rx=".4" fill="currentColor" />)}
        </svg>
        <div className="leading-tight">
          <div className="text-xs font-semibold">{p.text}</div>
          <div className="text-[11px] text-muted">{p.gate}</div>
        </div>
      </div>
    </div>
  );
}

function Stage({ step }: { step: number }) {
  const balance = useCountUp(STEPS[step].balance, true, 1100);
  const second = step === 3 ? { name: "Chidi", role: "New owner" } : { name: "Tunde", role: "Borrowing for one match" };
  return (
    <div
      className="story rounded-[28px] border border-line bg-card-2 p-4 sm:p-5"
      data-step={step}
      data-filled={step >= 1}
      role="img"
      aria-label={`Step ${step + 1} of 4: ${STEPS[step].title}. ${STEPS[step].body}`}
    >
      <svg viewBox="0 0 400 190" className="w-full" aria-hidden>
        {SEATS.map(({ r, c, i }) => {
          const ours = r === OURS.r && c === OURS.c;
          return ours ? null : (
            <rect key={i} className="story-seat" data-sold={sold(r, c) ? "" : undefined} x={seatX(c)} y={seatY(r, c)} width="22" height="17" rx="5"
              style={{ "--d": `${(i * 37) % 600}ms` } as CSSProperties} />
          );
        })}
        <rect className="story-ring" x={seatX(OURS.c)} y={seatY(OURS.r, OURS.c)} width="22" height="17" rx="5" fill="none" stroke="#b8e62b" strokeWidth="1.5" />
        <rect x={seatX(OURS.c)} y={seatY(OURS.r, OURS.c)} width="22" height="17" rx="5" fill="#b8e62b" />
        {COIN_SEATS.map(({ r, c, i }, n) => {
          const x = seatX(c) + 11, y = seatY(r, c) + 8;
          return <circle key={i} className="story-coin" cx={x} cy={y} r="4" fill="#b8e62b"
            style={{ "--tx": `${200 - x}px`, "--ty": `${196 - y}px`, "--d": `${n * 260}ms` } as CSSProperties} />;
        })}
      </svg>

      <div className="rounded-2xl border border-lime/50 bg-ink p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-white/80">The account owned by seat C5-12</span>
          <span className="chip shrink-0 text-lime">0 keys</span>
        </div>
        <div className="mono mt-1 truncate text-xs text-muted">seat-c5-12.nearseat.testnet</div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-number text-5xl leading-none text-lime tabular-nums">{balance.toFixed(2)}</span>
          <span className="text-sm text-muted">tUSDC</span>
        </div>
        <div className="mt-1 min-h-4 text-xs text-muted">{STEPS[step].note}</div>
      </div>

      <div className="relative mt-3 grid grid-cols-2 gap-3">
        <div className="story-token absolute left-0 top-0 z-10 w-[calc(50%-6px)] p-2">
          <div className="flex items-center gap-2 rounded-xl bg-lime px-2 py-1 text-lime-ink">
            <span className="rounded-md bg-ink p-0.5"><Crest size={18} /></span>
            <span className="truncate text-xs font-bold">Membership NFT</span>
          </div>
        </div>
        <Holder name="Amaka" role={step === 3 ? "Former owner" : step === 2 ? "Owner, away this match" : "Owner"} pass={step === 3 ? "refused" : step === 2 ? "paused" : "valid"} />
        <Holder name={second.name} role={second.role} pass="valid" hidden={step < 2} />
      </div>
    </div>
  );
}

export function SeatStory() {
  const wide = useMedia("(min-width: 1024px)");
  const [step, setStep] = useState(0);
  const [touched, setTouched] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);
  const visible = useInView(root, { once: false, margin: "0px" });

  // Wide screens: the step nearest the middle of the viewport is the active one.
  useEffect(() => {
    if (!wide) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.i));
    }, { rootMargin: "-48% 0px -48% 0px" });
    stepRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [wide]);

  // Phones: play through the steps until the reader takes over.
  useEffect(() => {
    if (wide || touched || !visible) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 4500);
    return () => clearInterval(t);
  }, [wide, touched, visible]);

  if (!wide) {
    return (
      <div ref={root}>
        <Stage step={step} />
        <div className="mt-4 flex gap-2" role="tablist" aria-label="Story steps">
          {STEPS.map((s, i) => (
            <button key={s.title} role="tab" aria-selected={i === step} aria-label={`Step ${i + 1}: ${s.title}`}
              onClick={() => { setTouched(true); setStep(i); }}
              className={`h-10 flex-1 rounded-full border font-number text-xl transition-colors ${i === step ? "border-lime bg-lime text-lime-ink" : "border-line text-muted"}`}>
              {i + 1}
            </button>
          ))}
        </div>
        <div className="mt-4 min-h-44">
          <h3 className="text-2xl font-bold">{STEPS[step].title}</h3>
          <p className="mt-2 text-white/75">{STEPS[step].body}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={root} className="grid grid-cols-[1fr_minmax(0,440px)] gap-16">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.title} data-i={i} ref={(el) => { stepRefs.current[i] = el; }}
            className={`flex min-h-[78vh] flex-col justify-center transition-opacity duration-500 ${i === step ? "opacity-100" : "opacity-30"}`}>
            <div className="font-number text-7xl leading-none text-lime">{i + 1}</div>
            <h3 className="mt-3 text-4xl font-extrabold">{s.title}</h3>
            <p className="mt-4 max-w-md text-lg text-white/75">{s.body}</p>
          </li>
        ))}
      </ol>
      <div>
        <div className="sticky top-[max(84px,calc(50vh-290px))]"><Stage step={step} /></div>
      </div>
    </div>
  );
}
