// The club's season seal: a glossy enamel badge with words set in a ring.
// It stays in the corner of the landing page and the ring turns with the
// scroll position (forwards going down, backwards going up), on top of a slow
// idle turn. The small dot blinks to show the contract is live.
import { useEffect, useRef } from "react";
import { reduced } from "../lib/motion";

const WORDS = "Become a member • Season 2026/27 • This seat earns • ";

export function SeasonSeal() {
  const ring = useRef<SVGGElement>(null);

  useEffect(() => {
    const el = ring.current;
    if (!el || reduced()) return;
    let raf = 0, last = performance.now(), idle = 0, eased = window.scrollY;
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      idle += dt * 0.008; // 8 degrees a second when the page is still
      eased += (window.scrollY - eased) * Math.min(1, dt / 140); // glide after the scroll, never snap
      el.style.transform = `rotate(${(idle + eased * 0.28).toFixed(2)}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <a href="#/join" aria-label="Become a member for season 2026/27"
      className="seal fixed bottom-4 right-4 z-30 block size-[84px] rounded-full sm:bottom-6 sm:right-6 sm:size-[124px]">
      <span className="seal-glow" aria-hidden />
      <span className="seal-face" aria-hidden>
        <svg viewBox="0 0 120 120" className="block size-full">
          <defs>
            <radialGradient id="seal-enamel" cx="38%" cy="26%" r="85%">
              <stop offset="0" stopColor="#c8486b" />
              <stop offset=".42" stopColor="#9b2545" />
              <stop offset="1" stopColor="#4d0f22" />
            </radialGradient>
            <linearGradient id="seal-rim" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff6df" />
              <stop offset=".5" stopColor="#b79a63" />
              <stop offset="1" stopColor="#ead9b5" />
            </linearGradient>
            <linearGradient id="seal-gloss" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".5" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <path id="seal-path" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" />
          </defs>
          <circle cx="60" cy="60" r="58.5" fill="url(#seal-enamel)" stroke="url(#seal-rim)" strokeWidth="2" />
          <g ref={ring} className="seal-ring">
            <text className="font-number" fontSize="13.5" fill="#f5ead2" style={{ textTransform: "uppercase" }}>
              <textPath href="#seal-path" textLength="274" lengthAdjust="spacing">{WORDS}</textPath>
            </text>
          </g>
          <circle cx="60" cy="60" r="31" fill="#140d10" stroke="url(#seal-rim)" strokeWidth="1.5" />
          <g transform="translate(39 38) scale(.66)">
            <path d="M32 5 L52 13 V33 C52 46 43 54 32 59 C21 54 12 46 12 33 V13 Z" fill="none" stroke="#ead9b5" strokeWidth="3.2" strokeLinejoin="round" />
            <polygon points="32.0,17.0 34.5,23.6 41.5,23.9 36.0,28.3 37.9,35.1 32.0,31.2 26.1,35.1 28.0,28.3 22.5,23.9 29.5,23.6" fill="#ead9b5" />
            <path d="M21 41 Q32 48 43 41" fill="none" stroke="#ead9b5" strokeWidth="3" strokeLinecap="round" />
          </g>
          {/* The gloss: a soft highlight over the top half, as on poured enamel. */}
          <ellipse cx="60" cy="33" rx="46" ry="27" fill="url(#seal-gloss)" opacity=".55" />
        </svg>
        <span className="seal-sheen" />
      </span>
      <span className="seal-dot" aria-hidden><span /></span>
    </a>
  );
}
