# Contract Deployment and Upgrade Runbook

This runbook describes the current `apps/onchain` Soroban contract. The
package is named `onchain`, so the release artifact is `onchain.wasm`—not
`vaultix_escrow.wasm`.

## 1. Prerequisites

Install the pinned Rust target and Stellar CLI, then verify that the account
used to sign transactions is funded on the selected network:

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli --version 26.0.0
stellar keys address deployer
```

The deployer needs enough native balance for upload, deployment, and invoke
fees. On testnet, fund it with the network friendbot. Never put a secret key
in a command, shell history, workflow input, or committed file; store it in
the CLI keychain or a protected CI secret.

## 2. Build and optimize

Run these commands from `apps/onchain`:

```bash
cargo build --target wasm32v1-none --release
stellar contract optimize \
  --wasm target/wasm32v1-none/release/onchain.wasm \
  --wasm-out target/wasm32v1-none/release/onchain.optimized.wasm
```

Confirm the artifact exists, review the source diff, and run the repository's
formatting and test checks before deployment.

## 3. Fresh deployment and initialization

The current contract uses the atomic `__constructor` at deployment time. It
sets `admin`, `operator`, `arbitrator`, `treasury`, and `fee_bps` in one
transaction, eliminating the permissionless-initializer window present in
older versions.

Deploy the optimized artifact with the constructor arguments required by the
contract (confirm exact argument spelling with `stellar contract deploy
--help` for the installed CLI):

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/onchain.optimized.wasm \
  --network testnet \
  --source-account deployer \
  -- \
  --admin G_ADMIN \
  --operator G_OPERATOR \
  --arbitrator G_ARBITRATOR \
  --treasury G_TREASURY \
  --fee_bps 50
```

Record the returned contract ID and verify initialization:

```bash
stellar contract invoke --id C_CONTRACT \
  --network testnet --source-account deployer -- is_initialized
stellar contract invoke --id C_CONTRACT \
  --network testnet --source-account deployer -- get_admin
stellar contract invoke --id C_CONTRACT \
  --network testnet --source-account deployer -- get_operator
stellar contract invoke --id C_CONTRACT \
  --network testnet --source-account deployer -- get_config
```

### Legacy `initialize` / `init` terminology

Older deployment notes described two calls, `initialize` for treasury and fee
followed by `init` for admin, operator, and arbitrator. That API was replaced
by `__constructor` in issue #621. New deployments must not call either legacy
entrypoint: they are not exported by the current contract and the invocation
will fail as an unknown function. A deployment that skips constructor
arguments is not partially initialized; protected operations return
`ContractNotInitialized` or a role-specific initialization error. The safe
remedy is to redeploy with complete constructor arguments.

For an already deployed legacy instance, do not guess at a migration order.
Confirm its version and storage layout with the maintainer, back up the
deployment record, and use a reviewed migration or a fresh deployment. Never
run `initialize` and `init` out of order on an old instance: the first
successful call may make the second fail with an initialization error, while a
partially configured instance can leave fee or role operations unavailable.

## 4. Upgrade procedure

`upgrade` is an admin-only entrypoint:

```bash
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32v1-none/release/onchain.optimized.wasm \
  --network testnet --source-account deployer)

stellar contract invoke --id C_CONTRACT \
  --network testnet --source-account deployer -- \
  upgrade --new_wasm_hash "$WASM_HASH"
```

The signer must be the stored admin. An upgrade keeps the contract ID and
existing storage, roles, escrows, and balances. Future WASM must preserve all
stored keys, structs, enum encodings, and migration assumptions in
`apps/onchain/src/lib.rs`.

### Pre-upgrade checklist

1. Review the contract diff and generated interface/spec for breaking changes.
2. Confirm every existing storage key and encoded type remains readable, or
   ship and test an explicit migration first.
3. Run invariant, authorization, upgrade, formatting, and full test checks.
4. Deploy and exercise the exact WASM on testnet before mainnet.
5. Confirm the signer is the current admin and preserve a rollback artifact.
6. Notify indexer and client owners about event or entrypoint changes.

## 5. Emergency pause and rollback

The operator—not an arbitrary deployer—controls the emergency circuit breaker:

```bash
stellar contract invoke --id C_CONTRACT \
  --network testnet --source-account operator -- \
  set_paused --paused true
```

Use `set_paused false` only after the operator confirms that the incident is
contained. Keep admin, operator, and arbitrator responsibilities separate in
production; a testnet may intentionally use one account for all roles.

Soroban has no automatic rollback. To roll back logic, rebuild the last
known-good commit, optimize it, upload it, and call `upgrade` with the current
admin. This preserves state but does not undo already-executed transactions.
If the storage layout is unsafe, pause the contract, deploy a new instance,
migrate only with a reviewed plan, and update every client and indexer to the
new contract ID instead of attempting an unsafe in-place rollback.

## 6. Testnet versus mainnet

- **Network and passphrase:** use `--network testnet` only for testnet. Mainnet
  requires the production network configuration and passphrase; never reuse a
  testnet secret or endpoint.
- **RPC and Horizon:** verify the CLI's configured RPC and Horizon endpoints
  before signing. A successful submission on one network does not prove that
  the contract exists on the other.
- **Funding:** testnet accounts can use friendbot; mainnet deployers require
  funded production accounts and an approved fee budget.
- **Keys and approvals:** keep production secrets in a hardware-backed or
  protected CI secret store and require maintainer approval for deployment and
  upgrade workflows.

## 7. Deployment record

Record the contract ID, network, source commit, optimized WASM hash, timestamp,
signer identity, mode, and any migration or rollback decision. The repository's
`apps/onchain/deployments/testnet.json` is suitable for testnet records;
production records must use the project's approved protected registry.
