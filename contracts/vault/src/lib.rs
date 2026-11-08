//! NearSeat member vault.
//!
//! One copy of this code runs on every membership's keyless sub-account,
//! e.g. `seat-c5-12.nearseat.testnet`. It is deployed once as a NEAR global
//! contract **by code hash**, so it can never be swapped for other code.
//!
//! The vault keeps no state and has no idea who the member is. It obeys exactly
//! one caller: its parent account (the NearSeat contract), which checks live
//! NFT ownership before every call. Whoever holds the NFT therefore controls
//! the vault, and nobody else can.
//!
//! Written against the raw NEAR host functions (`near-sys`) with no heap and no
//! std on wasm, so the whole contract is a few KB. Global contracts cost about
//! 10x normal storage per byte, and a small vault is also easy to audit:
//! the only exported methods are `pay`, `parent` and `version`.

#![cfg_attr(target_arch = "wasm32", no_std)]

/// Longest NEAR account id.
pub const MAX_ACCOUNT_LEN: usize = 64;
/// `{"receiver_id":"<64>","amount":"<39 digits>"}` fits comfortably.
pub const JSON_BUF: usize = 160;
pub const VERSION: &[u8] = b"\"1.0.0\"";

/// Parses borsh-encoded `(token: String, receiver: String, amount: u128)`.
pub fn parse_pay_args(input: &[u8]) -> Option<(&[u8], &[u8], u128)> {
    fn string(buf: &[u8]) -> Option<(&[u8], &[u8])> {
        let len = u32::from_le_bytes(buf.get(..4)?.try_into().ok()?) as usize;
        if len == 0 || len > MAX_ACCOUNT_LEN {
            return None;
        }
        let s = buf.get(4..4 + len)?;
        Some((s, &buf[4 + len..]))
    }
    let (token, rest) = string(input)?;
    let (receiver, rest) = string(rest)?;
    if rest.len() != 16 {
        return None;
    }
    let amount = u128::from_le_bytes(rest.try_into().ok()?);
    let valid = |s: &[u8]| s.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"-_.".contains(c));
    if !valid(token) || !valid(receiver) {
        return None;
    }
    Some((token, receiver, amount))
}

/// `seat-c5-12.nearseat.testnet` -> `nearseat.testnet`.
pub fn parent_of(account: &[u8]) -> Option<&[u8]> {
    let dot = account.iter().position(|c| *c == b'.')?;
    Some(&account[dot + 1..])
}

/// Writes `{"receiver_id":"..","amount":".."}` into `out`, returns its length.
pub fn ft_transfer_json(receiver: &[u8], amount: u128, out: &mut [u8; JSON_BUF]) -> usize {
    let mut digits = [0u8; 40];
    let mut n = amount;
    let mut i = digits.len();
    loop {
        i -= 1;
        digits[i] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    let parts: [&[u8]; 5] = [b"{\"receiver_id\":\"", receiver, b"\",\"amount\":\"", &digits[i..], b"\"}"];
    let mut len = 0;
    for part in parts {
        out[len..len + part.len()].copy_from_slice(part);
        len += part.len();
    }
    len
}

#[cfg(target_arch = "wasm32")]
mod host {
    use super::*;
    use near_sys as sys;

    const REG: u64 = 0;
    const GAS_FOR_FT_TRANSFER: u64 = 10_000_000_000_000; // 10 Tgas
    const ONE_YOCTO: u128 = 1;

    #[panic_handler]
    fn on_panic(_: &core::panic::PanicInfo) -> ! {
        unsafe { sys::panic() }
    }

    fn fail(msg: &str) -> ! {
        unsafe { sys::panic_utf8(msg.len() as u64, msg.as_ptr() as u64) }
    }

    /// Copies register 0 into `buf`, returns the filled slice.
    fn read<'a>(buf: &'a mut [u8]) -> &'a [u8] {
        let len = unsafe { sys::register_len(REG) } as usize;
        if len > buf.len() {
            fail("input too large");
        }
        unsafe { sys::read_register(REG, buf.as_mut_ptr() as u64) };
        &buf[..len]
    }

    fn assert_parent() {
        let mut cur = [0u8; MAX_ACCOUNT_LEN];
        let mut pred = [0u8; MAX_ACCOUNT_LEN];
        unsafe { sys::current_account_id(REG) };
        let cur = read(&mut cur);
        unsafe { sys::predecessor_account_id(REG) };
        let pred = read(&mut pred);
        if parent_of(cur) != Some(pred) {
            fail("vault only obeys its parent contract");
        }
    }

    /// Parent-only. Sends `amount` of fungible token `token` to `receiver`.
    /// Returns the transfer promise so the parent's callback sees its outcome.
    #[no_mangle]
    pub extern "C" fn pay() {
        assert_parent();
        let mut input = [0u8; 4 + MAX_ACCOUNT_LEN + 4 + MAX_ACCOUNT_LEN + 16];
        unsafe { sys::input(REG) };
        let input = read(&mut input);
        let Some((token, receiver, amount)) = parse_pay_args(input) else {
            fail("bad pay arguments");
        };
        if amount == 0 {
            fail("amount must be positive");
        }
        let mut json = [0u8; JSON_BUF];
        let json_len = ft_transfer_json(receiver, amount, &mut json);
        let method = b"ft_transfer";
        let deposit = ONE_YOCTO.to_le_bytes();
        unsafe {
            let p = sys::promise_batch_create(token.len() as u64, token.as_ptr() as u64);
            sys::promise_batch_action_function_call(
                p,
                method.len() as u64,
                method.as_ptr() as u64,
                json_len as u64,
                json.as_ptr() as u64,
                deposit.as_ptr() as u64,
                GAS_FOR_FT_TRANSFER,
            );
            sys::promise_return(p);
        }
    }

    /// The only account this vault obeys (JSON string).
    #[no_mangle]
    pub extern "C" fn parent() {
        let mut cur = [0u8; MAX_ACCOUNT_LEN];
        unsafe { sys::current_account_id(REG) };
        let cur = read(&mut cur);
        let parent = parent_of(cur).unwrap_or_else(|| fail("vault must be a sub-account"));
        let mut out = [0u8; MAX_ACCOUNT_LEN + 2];
        out[0] = b'"';
        out[1..1 + parent.len()].copy_from_slice(parent);
        out[1 + parent.len()] = b'"';
        unsafe { sys::value_return((parent.len() + 2) as u64, out.as_ptr() as u64) };
    }

    #[no_mangle]
    pub extern "C" fn version() {
        unsafe { sys::value_return(VERSION.len() as u64, VERSION.as_ptr() as u64) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn borsh(token: &str, receiver: &str, amount: u128) -> Vec<u8> {
        let mut v = vec![];
        for s in [token, receiver] {
            v.extend((s.len() as u32).to_le_bytes());
            v.extend(s.as_bytes());
        }
        v.extend(amount.to_le_bytes());
        v
    }

    #[test]
    fn parent_is_everything_after_the_first_dot() {
        assert_eq!(parent_of(b"seat-c5-12.nearseat.testnet"), Some(&b"nearseat.testnet"[..]));
        assert_eq!(parent_of(b"toplevel"), None);
    }

    #[test]
    fn parses_pay_args() {
        let input = borsh("tusdc.testnet", "alice.testnet", 1_234_567);
        let (t, r, a) = parse_pay_args(&input).unwrap();
        assert_eq!((t, r, a), (&b"tusdc.testnet"[..], &b"alice.testnet"[..], 1_234_567));
    }

    #[test]
    fn rejects_trailing_bytes_and_bad_accounts() {
        let mut input = borsh("tusdc.testnet", "alice.testnet", 1);
        input.push(0);
        assert!(parse_pay_args(&input).is_none());
        assert!(parse_pay_args(&borsh("tusdc.testnet", "Alice\"}", 1)).is_none());
        assert!(parse_pay_args(&borsh("", "alice.testnet", 1)).is_none());
    }

    #[test]
    fn builds_ft_transfer_json() {
        let mut out = [0u8; JSON_BUF];
        let n = ft_transfer_json(b"bob.testnet", u128::MAX, &mut out);
        assert_eq!(
            core::str::from_utf8(&out[..n]).unwrap(),
            format!(r#"{{"receiver_id":"bob.testnet","amount":"{}"}}"#, u128::MAX)
        );
        let n = ft_transfer_json(b"a.testnet", 0, &mut out);
        assert_eq!(&out[..n], br#"{"receiver_id":"a.testnet","amount":"0"}"#);
    }
}
