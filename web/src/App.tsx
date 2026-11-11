import { useEffect, useState, type ReactNode } from "react";
import { useWallet } from "./near/wallet";
import { config } from "./config";
import { Logo } from "./components/ui";
import { Landing } from "./pages/Landing";
import { MemberPage } from "./pages/Member";
import { MatchesPage } from "./pages/Matches";
import { ClubPage } from "./pages/Club";
import { VerifyPage } from "./pages/Verify";
import { PassPage } from "./pages/Pass";
import { ScanPage } from "./pages/Scan";
import { MarketPage } from "./pages/Market";
import { MembersOnlyPage } from "./pages/MembersOnly";
import { AttackLabPage } from "./pages/AttackLab";
import { JoinPage } from "./pages/Join";
import { WhitepaperPage } from "./pages/Whitepaper";
import { StatementPage } from "./pages/Statement";
import { WalletMenu } from "./components/WalletMenu";
import { Footer } from "./components/Footer";

/** Tiny hash router: works on any static host (GitHub Pages, Vercel). */
function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, "") || "").split("/").filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => {
      setParts(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return parts;
}

const NAV = [
  ["", "Home"],
  ["join", "Join"],
  ["member", "My membership"],
  ["matches", "Matches"],
  ["market", "Market"],
  ["club", "Club"],
  ["lab", "Attack Lab"],
] as const;

const LANDING_PARTS = ["", "how", "roadmap", "faq"];

function Nav({ route }: { route: string }) {
  const { accountId, signIn, ready } = useWallet();
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <a href="#/" className="flex items-center" aria-label="NearSeat home">
          <Logo size={32} />
        </a>
        <nav className="mx-auto hidden rounded-full border border-line bg-card p-1 lg:flex" aria-label="Main">
          {NAV.map(([href, label]) => (
            <a
              key={href}
              href={`#/${href}`}
              aria-current={route === href ? "page" : undefined}
              className={`rounded-full px-4 py-1.5 text-sm ${route === href ? "bg-card-2 text-white" : "text-muted hover:text-white"}`}
            >
              {label}
            </a>
          ))}
        </nav>
        {accountId ? (
          <WalletMenu accountId={accountId} />
        ) : (
          <button className="btn-primary ml-auto lg:ml-0" onClick={signIn} disabled={!ready}>
            Connect wallet
          </button>
        )}
      </div>
      <nav className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden" aria-label="Main (mobile)">
        {NAV.map(([href, label]) => (
          <a
            key={href}
            href={`#/${href}`}
            aria-current={route === href ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${route === href ? "bg-card-2 text-white" : "text-muted"}`}
          >
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

export function App() {
  const [page = "", arg] = useRoute();
  let body: ReactNode;
  switch (page) {
    case "member": body = <MemberPage tokenId={arg} />; break;
    case "join": body = <JoinPage />; break;
    case "matches": body = <MatchesPage />; break;
    case "club": body = <ClubPage />; break;
    case "verify": body = <VerifyPage tokenId={arg} />; break;
    case "statement": body = <StatementPage tokenId={arg} />; break;
    case "pass": body = <PassPage tokenId={arg} />; break;
    case "scan": body = <ScanPage />; break;
    case "market": body = <MarketPage />; break;
    case "members": body = <MembersOnlyPage />; break;
    case "lab": body = <AttackLabPage />; break;
    case "whitepaper": body = <WhitepaperPage />; break;
    default: body = <div className="py-20 text-center text-muted">Page not found. <a className="text-lime" href="#/">Go home</a></div>;
  }
  // The landing page runs edge to edge; "how", "roadmap" and "faq" are parts of it.
  const landing = LANDING_PARTS.includes(page);
  return (
    <>
      <Nav route={landing ? "" : page} />
      <ContractAccountWarning />
      {landing ? <Landing section={page || undefined} /> : <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:pt-10">{body}</main>}
      <Footer />
    </>
  );
}

/** The contract can't pay itself (NEP-141 forbids sender == receiver), so warn early. */
function ContractAccountWarning() {
  const { accountId } = useWallet();
  if (accountId !== config.contractId) return null;
  return (
    <div className="border-b border-warn/40 bg-warn/10 px-4 py-3 text-center text-sm text-warn" role="alert">
      You're connected as <b>{accountId}</b>, the NearSeat contract account itself. It can't buy tickets or memberships from itself.
      Connect a fan wallet (any other testnet account) to try the app.
    </div>
  );
}
