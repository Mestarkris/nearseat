//! On-chain SVG for the dynamic membership card and single-match tickets.
//!
//! The card is rebuilt from contract state on every `nft_token` call: tier,
//! six stats, balance, passes left, next fixture, "Lent to @renter", and
//! attendance + goal stamps. Every string is XML-escaped (threat T55).

use crate::*;
use near_sdk::base64::engine::general_purpose::STANDARD;
use near_sdk::base64::Engine;

const BG: &str = "#0A0C0F";
const LIME: &str = "#B8E62B";
const BORDER: &str = "#232A31";
const CARD: &str = "#12161B";
const CARD2: &str = "#151A20";
const MUTED: &str = "#8A949E";

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
    out
}

/// 6-decimal tUSDC as "12.50".
pub fn usd(amount: u128) -> String {
    let cents = amount / 10_000;
    format!("{}.{:02}", cents / 100, cents % 100)
}

fn data_uri(svg: &str) -> String {
    format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg.as_bytes()))
}

fn crest(x: u32, y: u32, r: u32) -> String {
    format!(
        r#"<g transform="translate({x} {y})"><circle r="{r}" fill="{BG}" stroke="{LIME}" stroke-width="2"/><path d="M0 -{a} L{b} -{c} L{b} {c} L0 {a} L-{b} {c} L-{b} -{c} Z" fill="none" stroke="{LIME}" stroke-width="1.5"/><text y="4" font-family="Inter Tight,Arial,sans-serif" font-size="{f}" font-weight="800" fill="{LIME}" text-anchor="middle">ISU</text></g>"#,
        a = r * 7 / 10,
        b = r * 6 / 10,
        c = r * 35 / 100,
        f = r * 2 / 3,
    )
}

pub fn crest_icon_data_uri() -> String {
    data_uri(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="{BG}"/>{}</svg>"#,
        crest(32, 32, 26)
    ))
}

pub fn ticket_svg_data_uri(t: &TicketInfo, m: Option<&Match>) -> String {
    let opponent = m.map(|m| escape(&m.opponent)).unwrap_or_default();
    data_uri(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 220"><rect width="400" height="220" rx="24" fill="{CARD}" stroke="{BORDER}"/>{crest}<text x="90" y="56" font-family="Inter Tight,Arial" font-size="18" font-weight="700" fill="white">ILLIA STARS v {opponent}</text><text x="90" y="80" font-family="Inter,Arial" font-size="12" fill="{MUTED}">MATCH {id} · SINGLE-MATCH TICKET · NON-TRANSFERABLE</text><text x="24" y="180" font-family="Bebas Neue,Impact,sans-serif" font-size="72" fill="{LIME}">{seat}</text></svg>"#,
        crest = crest(50, 62, 26),
        id = t.match_id,
        seat = escape(&t.seat.to_uppercase()),
    ))
}

impl NearSeat {
    pub(crate) fn membership_svg_data_uri(&self, token_id: &TokenId) -> String {
        let m = self.member(token_id);
        let tier = self.tier_of(m);
        let (unsettled, _) = self.unsettled_of(m);
        let stamps = self.goal_stamps(m);
        let next = self
            .matches
            .values()
            .filter(|mm| matches!(mm.status, MatchStatus::Scheduled | MatchStatus::Live))
            .min_by_key(|mm| mm.kickoff_at.0);
        let lent_to = next.and_then(|mm| match self.loans.get(&(mm.id, token_id.clone())) {
            Some(Loan::Rented { renter, .. }) => Some(renter.clone()),
            _ => None,
        });

        let stats = [
            ("ATT", m.attended.len().to_string()),
            ("BAL", usd(m.vault_balance)),
            ("PAS", self.passes_left(token_id).to_string()),
            ("SHR", usd(m.totals.pool_earned.0 + unsettled)),
            ("LND", usd(m.totals.loan_income.0)),
            ("RFD", usd(m.totals.loan_refunds.0)),
        ];
        let mut tiles = String::new();
        for (i, (label, value)) in stats.iter().enumerate() {
            let x = 24 + (i as u32 % 3) * 120;
            let y = 318 + (i as u32 / 3) * 70;
            tiles.push_str(&format!(
                r#"<rect x="{x}" y="{y}" width="112" height="60" rx="14" fill="{BG}" fill-opacity="0.7" stroke="{BORDER}"/><text x="{tx}" y="{ly}" font-family="Inter,Arial" font-size="11" fill="{MUTED}">{label}</text><text x="{tx}" y="{vy}" font-family="Inter Tight,Arial" font-size="20" font-weight="700" fill="white">{value}</text>"#,
                tx = x + 12,
                ly = y + 20,
                vy = y + 46,
                value = escape(value),
            ));
        }
        let mut stamp_row = String::new();
        for i in 0..m.attended.len().min(10) {
            stamp_row.push_str(&format!(
                r#"<circle cx="{}" cy="476" r="7" fill="{LIME}"/>"#,
                32 + i as u32 * 20
            ));
        }
        for (i, _) in stamps.iter().take(10).enumerate() {
            stamp_row.push_str(&format!(
                r#"<text x="{}" y="500" font-family="Inter,Arial" font-size="13" fill="white">⚽</text>"#,
                26 + i as u32 * 20
            ));
        }
        let banner = match (&lent_to, next) {
            (Some(r), _) => format!("LENT TO @{}", escape(r.as_str())),
            (None, Some(mm)) => format!("NEXT: v {}", escape(&mm.opponent.to_uppercase())),
            (None, None) => "SEASON COMPLETE".to_string(),
        };
        let listed = if m.listing.is_some() {
            format!(r#"<rect x="276" y="96" width="100" height="26" rx="13" fill="{LIME}"/><text x="326" y="114" font-family="Inter,Arial" font-size="12" font-weight="700" fill="{BG}" text-anchor="middle">FOR SALE</text>"#)
        } else {
            String::new()
        };

        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600"><defs><pattern id="p" width="40" height="600" patternUnits="userSpaceOnUse"><rect width="20" height="600" fill="{CARD}"/><rect x="20" width="20" height="600" fill="{CARD2}"/></pattern></defs><rect width="400" height="600" rx="24" fill="url(#p)" stroke="{BORDER}"/><g stroke="white" stroke-opacity="0.06" fill="none"><rect x="24" y="24" width="352" height="552" rx="8"/><line x1="24" y1="300" x2="376" y2="300"/><circle cx="200" cy="300" r="48"/></g>{crest}<text x="88" y="50" font-family="Inter Tight,Arial" font-size="14" font-weight="800" fill="white">ILLIA STARS UNITED</text><text x="88" y="70" font-family="Inter,Arial" font-size="11" fill="{MUTED}">SEASON {season} · MEMBERSHIP</text><rect x="24" y="96" width="{tw}" height="26" rx="13" fill="none" stroke="{LIME}"/><text x="{tcx}" y="114" font-family="Inter,Arial" font-size="12" font-weight="700" fill="{LIME}" text-anchor="middle">{tier}</text>{listed}<text x="24" y="232" font-family="Bebas Neue,Impact,sans-serif" font-size="120" fill="white">{seat}</text><text x="24" y="272" font-family="Inter,Arial" font-size="13" font-weight="600" fill="{LIME}">{banner}</text>{tiles}{stamp_row}<rect x="24" y="516" width="352" height="48" rx="14" fill="{BG}" stroke="{LIME}" stroke-opacity="0.5"/><text x="38" y="536" font-family="Inter,Arial" font-size="11" fill="{LIME}">OWNS ITS OWN ACCOUNT · KEYS: 0</text><text x="38" y="554" font-family="Inter,Arial" font-size="11" fill="white">{vault}</text></svg>"#,
            crest = crest(52, 56, 26),
            season = escape(&self.season_name),
            tw = 24 + tier.label().len() as u32 * 9,
            tcx = 24 + (24 + tier.label().len() as u32 * 9) / 2,
            tier = tier.label(),
            seat = escape(&m.seat.to_uppercase()),
            vault = escape(m.vault.as_str()),
        );
        data_uri(&svg)
    }
}

#[cfg(test)]
mod svg_tests {
    use super::*;

    #[test]
    fn escapes_markup() {
        assert_eq!(escape(r#"<script>"x"&'y'</script>"#), "&lt;script&gt;&quot;x&quot;&amp;&apos;y&apos;&lt;/script&gt;");
    }

    #[test]
    fn formats_six_decimals() {
        assert_eq!(usd(12_500_000), "12.50");
        assert_eq!(usd(0), "0.00");
        assert_eq!(usd(1_999_999), "1.99");
    }
}
