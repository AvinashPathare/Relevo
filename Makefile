# Elivo Payout Guard — testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
SHELL := /bin/bash
CARGO ?= $(shell command -v cargo 2>/dev/null || echo $(HOME)/.cargo/bin/cargo)
RES := contracts/res

.PHONY: wasm test-contracts fmt lint sputnik

wasm:
	$(CARGO) near build non-reproducible-wasm --manifest-path contracts/mock-usdc/Cargo.toml --no-abi --out-dir target/near/mock_usdc
	$(CARGO) near build non-reproducible-wasm --manifest-path contracts/escrow/Cargo.toml --no-abi --out-dir target/near/elivo_escrow
	cp target/near/mock_usdc/mock_usdc.wasm $(RES)/mock_usdc.wasm
	cp target/near/elivo_escrow/elivo_escrow.wasm $(RES)/elivo_escrow.wasm
	@ls -la $(RES)/*.wasm

sputnik:
	node scripts/fetch-sputnik.mjs

test-contracts: wasm sputnik
	$(CARGO) test --workspace

fmt:
	$(CARGO) fmt --all --check

lint:
	$(CARGO) clippy --workspace --all-targets -- -D warnings
