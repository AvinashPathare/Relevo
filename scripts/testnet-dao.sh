#!/usr/bin/env bash
# Creates the demo Sputnik DAO on testnet through the official factory (sputnikv2.testnet),
# with the deployment's council account as its only council member, funds it with mock USDC,
# and records it in deployments/testnet.json. Resumable (state in .data/dao-<root>.done).
# Testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
source scripts/lib/near-steps.sh

j() { node -e "console.log(require('./deployments/testnet.json')['$1'])"; }
ROOT=$(j root); USDC=$(j usdc); ESCROW=$(j escrow); COUNCIL=$(j council)
mkdir -p .data
DONE=".data/dao-$ROOT.done"; touch "$DONE"
TS=$(grep -m1 '^ts:' "$DONE" | cut -d: -f2 || true)
if [ -z "$TS" ]; then TS=$(date +%s); echo "ts:$TS" >> "$DONE"; fi
NAME="elivo-$TS"
DAO="$NAME.sputnikv2.testnet"
FUND_A="pgdao-$TS-a.testnet"; FUND_B="pgdao-$TS-b.testnet"

say "Funding the council ($COUNCIL) from two faucet accounts"
faucet "$FUND_A"
faucet "$FUND_B"
step "pool:$FUND_A" near tokens "$FUND_A" send-near "$COUNCIL" '9.8 NEAR' $NET $SIGN
step "pool:$FUND_B" near tokens "$FUND_B" send-near "$COUNCIL" '9.8 NEAR' $NET $SIGN

say "Creating $DAO via sputnikv2.testnet (council: $COUNCIL)"
DAO_ARGS=$(node -e "console.log(Buffer.from(JSON.stringify({config:{name:'$NAME',purpose:'Elivo Payout Guard demo (testnet prototype)',metadata:''},policy:['$COUNCIL']})).toString('base64'))")
call sputnikv2.testnet create "{\"name\":\"$NAME\",\"args\":\"$DAO_ARGS\"}" "$COUNCIL" '6 NEAR' '300.0 Tgas'

say "Funding the DAO with mock USDC and escrow storage credit"
call "$USDC" storage_deposit "{\"account_id\":\"$DAO\"}" "$COUNCIL" '0.0125 NEAR'
call "$USDC" mint "{\"account_id\":\"$DAO\",\"amount\":\"50000000000\"}" "$USDC"
call "$ESCROW" storage_deposit "{\"account_id\":\"$DAO\"}" "$COUNCIL" '1 NEAR'

node -e "
const fs=require('fs');const p='deployments/testnet.json';const d=JSON.parse(fs.readFileSync(p));
d.dao='$DAO';d.rpcUrl=d.rpcUrl||'https://rpc.testnet.near.org';fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n');"
say "Done: $DAO  https://testnet.nearblocks.io/address/$DAO"
