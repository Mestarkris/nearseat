//! NEP-297 events plus an on-chain ring buffer of recent events.
//!
//! The frontend polls `get_feed` over plain RPC every few seconds, so the live
//! feed needs no indexer. Every entry is also logged as a standard
//! `EVENT_JSON:` NEP-297 event for indexers and explorers.

use crate::*;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{env, near};

pub const EVENT_STANDARD: &str = "nearseat";
pub const EVENT_VERSION: &str = "1.0.0";
/// How many recent events the contract keeps for the live feed.
pub const FEED_SIZE: u64 = 64;

impl NearSeat {
    pub(crate) fn emit(&mut self, event: &str, data: Value) {
        let log = json!({
            "standard": EVENT_STANDARD,
            "version": EVENT_VERSION,
            "event": event,
            "data": [data],
        });
        env::log_str(&format!("EVENT_JSON:{log}"));

        self.feed_seq += 1;
        let item = FeedItem {
            seq: self.feed_seq.into(),
            at: env::block_timestamp().into(),
            event: event.to_string(),
            data: serde_json::to_string(&data).unwrap_or_default(),
        };
        self.feed.insert(self.feed_seq % FEED_SIZE, item);
    }
}

#[near]
impl NearSeat {
    /// Recent events with `seq > since`, oldest first, at most `FEED_SIZE`.
    pub fn get_feed(&self, since: Option<near_sdk::json_types::U64>) -> Vec<FeedItem> {
        let since = since.map(|s| s.0).unwrap_or(0);
        let first = self
            .feed_seq
            .saturating_sub(FEED_SIZE - 1)
            .max(since + 1)
            .max(1);
        (first..=self.feed_seq)
            .filter_map(|seq| self.feed.get(&(seq % FEED_SIZE)).cloned())
            .filter(|item| item.seq.0 > since)
            .collect()
    }
}
