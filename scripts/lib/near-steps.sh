# Shared helpers for testnet scripts (source this file). Requires: near (near-cli-rs), node.
# step <id> <cmd...>: runs once per state file; completed ids are recorded and skipped on resume.
# retry: resends only errors where the transaction was never included (expired / rate limit / 5xx).
NET="network-config testnet"
SIGN="sign-with-legacy-keychain send"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
retry() {
  local out i
  for i in 1 2 3 4 5; do
    if out=$("$@" 2>&1); then return 0; fi
    if grep -qiE "has expired|rate limit|502|503|504" <<<"$out"; then
      echo "  transient RPC error, retry $i/5" >&2; sleep $((i * 8)); continue
    fi
    echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | tail -15 >&2; return 1
  done
  echo "$out" | sed 's/\x1b\[[0-9;]*m//g' | tail -15 >&2; return 1
}
step() {
  local id=$1; shift
  if grep -qxF "$id" "$DONE"; then return 0; fi
  retry "$@"
  echo "$id" >> "$DONE"
  sleep 1
}
call_raw() { # call_raw <contract> <method> <json> <signer> [deposit] [gas]
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas "${6:-100.0 Tgas}" attached-deposit "${5:-0 NEAR}" sign-as "$4" $NET $SIGN
}
call() { step "call:$1:$2:$3:$4" call_raw "$@"; }
faucet() { step "faucet:$1" near account create-account sponsor-by-faucet-service "$1" autogenerate-new-keypair save-to-legacy-keychain $NET create; }
