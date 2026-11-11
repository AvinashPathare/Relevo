# Elivo Payout Guard — testnet prototype. Payout firms and SPEI receipts are simulated. Contract unaudited.
SHELL := /bin/bash
CARGO ?= $(shell command -v cargo 2>/dev/null || echo $(HOME)/.cargo/bin/cargo)
RES := contracts/res
# Strip machine-specific paths from panic locations embedded in the wasm.
REMAP := --remap-path-prefix=$(HOME)/.cargo/registry/src=/cargo/registry --remap-path-prefix=$(HOME)/.cargo/git=/cargo/git --remap-path-prefix=$(HOME)/.rustup=/rustup --remap-path-prefix=$(CURDIR)=/elivo
NEAR_BUILD := $(CARGO) near build non-reproducible-wasm --no-abi --env "RUSTFLAGS=$(REMAP)"

.PHONY: wasm test-contracts fmt lint sputnik deploy-testnet setup test test-ts

wasm:
	$(NEAR_BUILD) --manifest-path contracts/mock-usdc/Cargo.toml --out-dir target/near/mock_usdc
	$(NEAR_BUILD) --manifest-path contracts/escrow/Cargo.toml --out-dir target/near/elivo_escrow
	@! strings target/near/*/*.wasm | grep -q "$(HOME)" || (echo "wasm contains local paths"; exit 1)
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

deploy-testnet:
	./scripts/deploy-testnet.sh

setup:
	pnpm install
	pnpm setup

test-ts:
	pnpm lint
	pnpm typecheck
	pnpm test

test: test-contracts test-ts
