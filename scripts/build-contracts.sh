#!/usr/bin/env bash
# Builds every contract to target/near/<name>/<name>.wasm and prints code hashes.
# The vault is no_std (no near-sdk), so it is built with plain cargo. No wasm-opt:
# its output depends on the binaryen version, which would make the hash
# differ between machines. Plain rustc output is deterministic for the pinned toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."

for c in tusdc mock-ft nearseat; do
  echo "→ building $c"
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi --locked)
done

echo "→ building vault"
cargo build -p nearseat-vault --target wasm32-unknown-unknown --release --locked
mkdir -p target/near/nearseat_vault
cp target/wasm32-unknown-unknown/release/nearseat_vault.wasm target/near/nearseat_vault/nearseat_vault.wasm

echo
echo "Code hashes (base58 sha256, what NEAR reports as code_hash):"
node scripts/code-hash.mjs target/near/*/*.wasm
