//! Layer 2: member voting.
//!
//! Voting power = the membership's verified attendance (gate check-ins)
//! before the poll opened. Votes are keyed by `(poll, token)`, not by account,
//! so selling a membership after voting doesn't give the buyer a second vote.

use crate::*;
use near_sdk::assert_one_yocto;
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Poll {
    pub id: u32,
    pub question: String,
    pub options: Vec<String>,
    pub tallies: Vec<u64>,
    pub starts_at: U64,
    pub ends_at: U64,
    pub voters: u32,
}

#[near]
impl NearSeat {
    /// Club-only.
    pub fn create_poll(&mut self, question: String, options: Vec<String>, duration_hours: u32) -> u32 {
        self.assert_club();
        require!(!question.is_empty() && question.len() <= 140, "question must be 1..140 chars");
        require!((2..=6).contains(&options.len()), "2..6 options");
        require!(options.iter().all(|o| !o.is_empty() && o.len() <= 40), "options must be 1..40 chars");
        require!((1..=24 * 14).contains(&duration_hours), "duration must be 1h..14d");
        let id = self.next_poll_id;
        self.next_poll_id += 1;
        let now = env::block_timestamp();
        let tallies = vec![0; options.len()];
        self.polls.insert(
            id,
            Poll {
                id,
                question: question.clone(),
                options,
                tallies,
                starts_at: U64(now),
                ends_at: U64(now + duration_hours as u64 * 3_600_000_000_000),
                voters: 0,
            },
        );
        self.emit("poll_created", json!({ "poll_id": id, "question": question }));
        id
    }

    /// Voting power this membership has in `poll_id`.
    pub fn vote_weight(&self, token_id: TokenId, poll_id: u32) -> u64 {
        let starts = self.polls.get(&poll_id).map(|p| p.starts_at.0).unwrap_or(0);
        self.member(&token_id).attended.iter().filter(|(_, at)| *at < starts).count() as u64
    }

    #[payable]
    pub fn vote(&mut self, token_id: TokenId, poll_id: u32, option: u32) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        let now = env::block_timestamp();
        let weight = self.vote_weight(token_id.clone(), poll_id);
        let key = (poll_id, token_id.clone());
        require!(!self.votes.contains(&key), "this membership already voted in this poll");
        require!(weight > 0, "needs at least one verified attendance before the poll opened");
        let poll = self.polls.get_mut(&poll_id).unwrap_or_else(|| env::panic_str("poll not found"));
        require!(now < poll.ends_at.0, "poll is closed");
        let slot = poll
            .tallies
            .get_mut(option as usize)
            .unwrap_or_else(|| env::panic_str("invalid option"));
        *slot += weight;
        poll.voters += 1;
        self.votes.insert(key);
        self.record(&token_id, "voted", Some(weight as u128), None, None);
        self.emit("vote_cast", json!({ "poll_id": poll_id, "token_id": token_id, "option": option, "weight": weight }));
    }

    pub fn get_polls(&self) -> Vec<Poll> {
        self.polls.values().cloned().collect()
    }

    pub fn has_voted(&self, poll_id: u32, token_id: TokenId) -> bool {
        self.votes.contains(&(poll_id, token_id))
    }
}
