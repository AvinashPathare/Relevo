#!/usr/bin/env bash
# Deploys a fresh Elivo Payout Guard instance to NEAR testnet (demo mode: 1 penalty "hour" = 10 s).
# Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
#
# Creates faucet-sponsored accounts (keys in ~/.near-credentials, legacy keychain), deploys the
# committed wasm, registers/approves/bonds MX-1..MX-3, gives the router a function-call key
# limited to the escrow's router methods, and writes deployments/testnet.json (account ids only).
#
# Requires: near-cli-rs (`near`), node 20+. Keys from scripts/gen-keys.mjs in .data/keys/.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
TS="${PG_TS:-$(date +%s)}"
ROOT="${PG_ROOT:-pg-$TS.testnet}"
ROOT_B="${ROOT%.testnet}-b.testnet"
USDC="usdc.$ROOT"; ESCROW="escrow.$ROOT"; ROUTER="router.$ROOT"; COUNCIL="council.$ROOT"
FIRMS=("mx1.$ROOT" "mx2.$ROOT" "mx3.$ROOT")
BOND="1000000000"   # 1,000 mUSDC per firm

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
mkdir -p .data
DONE=".data/deploy-$ROOT.done"; touch "$DONE"
# Retry only errors where the transaction was never included (safe to resend).
retry() {
  local out i
  for i in 1 2 3 4 5; do
    if out=$("$@" 2>&1); then return 0; fi
    if grep -qiE "has expired|timeout|timed out|rate limit|502|503|504|connection" <<<"$out"; then
      echo "  transient RPC error, retry $i/5" >&2; sleep $((i * 8)); continue
    fi
    echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | tail -15 >&2; return 1
  done
  echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | tail -15 >&2; return 1
}
# step <id> <cmd...>: run once per deployment; completed steps are recorded and skipped on resume.
step() {
  local id=$1; shift
  if grep -qxF "$id" "$DONE"; then return 0; fi
  retry "$@"
  echo "$id" >> "$DONE"
  sleep 1 # stay under the public RPC rate limit
}
pk_of() { node -e "console.log(require('./.data/keys/$1.json').public_key)"; }
call_raw() { # call_raw <contract> <method> <json> <signer> [deposit] [gas]
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas "${6:-100.0 Tgas}" attached-deposit "${5:-0 NEAR}" sign-as "$4" $NET $SIGN
}
call() { step "call:$1:$2:$3:$4" call_raw "$@"; }
faucet() { step "faucet:$1" near account create-account sponsor-by-faucet-service "$1" autogenerate-new-keypair save-to-legacy-keychain $NET create; }
subacct() { step "subacct:$1" near account create-account fund-myself "$1" "$2" autogenerate-new-keypair save-to-legacy-keychain sign-as "$ROOT" $NET $SIGN; }

node scripts/gen-keys.mjs oracle receipt mx1 mx2 mx3 router-fc >/dev/null
[ -f contracts/res/elivo_escrow.wasm ] || { echo "missing wasm: run make wasm"; exit 1; }

if [ -z "${PG_ROOT:-}" ] || ! grep -q "^pool:" "$DONE"; then
  say "Creating faucet accounts $ROOT and $ROOT_B"
  faucet "$ROOT"
  faucet "$ROOT_B"
  sleep 2
  step "pool:$ROOT_B" near tokens "$ROOT_B" send-near "$ROOT" '9.8 NEAR' $NET $SIGN
fi

say "Creating subaccounts"
subacct "$USDC" '2.5 NEAR'
subacct "$ESCROW" '4 NEAR'
subacct "$ROUTER" '1 NEAR'
subacct "$COUNCIL" '2.5 NEAR'
for f in "${FIRMS[@]}"; do subacct "$f" '0.5 NEAR'; done

say "Deploying mock USDC and escrow"
step "deploy:usdc" near contract deploy "$USDC" use-file contracts/res/mock_usdc.wasm with-init-call new \
  json-args "{\"owner_id\":\"$USDC\",\"total_supply\":\"0\"}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN >/dev/null
step "deploy:escrow" near contract deploy "$ESCROW" use-file contracts/res/elivo_escrow.wasm with-init-call new \
  json-args "{\"owner_id\":\"$ROOT\",\"token_id\":\"$USDC\",\"router_id\":\"$ROUTER\",\"oracle_pk\":\"$(pk_of oracle)\",\"receipt_pk\":\"$(pk_of receipt)\",\"demo_mode\":true}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' $NET $SIGN

say "Registering accounts on mock USDC"
for a in "$ESCROW" "$ROUTER" "$COUNCIL" "$ROOT" "${FIRMS[@]}"; do
  call "$USDC" storage_deposit "{\"account_id\":\"$a\"}" "$ROOT" '0.0125 NEAR'
done

say "Registering, approving and bonding firms"
for i in 0 1 2; do
  f="${FIRMS[$i]}"; n=$((i + 1))
  call "$ESCROW" storage_deposit "{\"account_id\":\"$f\"}" "$ROOT" '0.1 NEAR'
  call "$ESCROW" register_firm "{\"pk\":\"$(pk_of mx$n)\"}" "$f"
  call "$ESCROW" approve_firm "{\"firm_id\":\"$f\"}" "$ROOT" '1 yoctoNEAR'
  call "$USDC" mint "{\"account_id\":\"$f\",\"amount\":\"$BOND\"}" "$USDC"
  call "$USDC" ft_transfer_call "{\"receiver_id\":\"$ESCROW\",\"amount\":\"$BOND\",\"msg\":\"{\\\"kind\\\":\\\"post_bond\\\"}\"}" "$f" '1 yoctoNEAR' '150.0 Tgas'
done

say "Adding the router's restricted function-call key"
step "fckey:router" near account add-key "$ROUTER" grant-function-call-access --allowance '0.5 NEAR' \
  --contract-account-id "$ESCROW" --function-names 'assign, reroute, settle, exclude, anchor_receipt, refund' \
  use-manually-provided-public-key "$(pk_of router-fc)" $NET $SIGN

cat > deployments/testnet.json <<JSON
{
  "network": "testnet",
  "demo_mode": true,
  "root": "$ROOT",
  "usdc": "$USDC",
  "escrow": "$ESCROW",
  "router": "$ROUTER",
  "firms": { "mx1": "${FIRMS[0]}", "mx2": "${FIRMS[1]}", "mx3": "${FIRMS[2]}" },
  "council": "$COUNCIL",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

say "Done. Explorer links"
for a in "$ESCROW" "$USDC" "$ROUTER" "${FIRMS[@]}"; do echo "  https://testnet.nearblocks.io/address/$a"; done
