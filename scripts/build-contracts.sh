#!/usr/bin/env bash
# Builds every contract to target/near/<name>/<name>.wasm and prints code hashes.
# The vault is no_std (no near-sdk), so it is built with plain cargo + wasm-opt.
set -euo pipefail
cd "$(dirname "$0")/.."

for c in tusdc mock-ft nearseat; do
  echo "→ building $c"
  (cd "contracts/$c" && cargo near build non-reproducible-wasm --no-abi --locked)
done

echo "→ building vault"
cargo build -p nearseat-vault --target wasm32-unknown-unknown --release --locked
mkdir -p target/near/nearseat_vault
wasm-opt -Oz --strip-debug --strip-producers \
  --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int \
  target/wasm32-unknown-unknown/release/nearseat_vault.wasm \
  -o target/near/nearseat_vault/nearseat_vault.wasm

echo
echo "Code hashes (base58 sha256, what NEAR reports as code_hash):"
node scripts/code-hash.mjs target/near/*/*.wasm
