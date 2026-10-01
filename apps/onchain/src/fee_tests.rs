use crate::{Error, Milestone, MilestoneStatus, VaultixEscrow, VaultixEscrowClient};
use soroban_sdk::{symbol_short, BytesN};

/// Comprehensive tests for the Configurable Fee Model feature (#93)
/// Tests cover:
/// - Default global fee behavior (no overrides)
/// - Token-level override only
/// - Escrow-level override only
/// - Combined scenarios ensuring precedence
/// - Invalid fee (out of range) rejections
/// - Fee precedence: escrow > token > global
/// - Fee rounding edge cases for Issue #305
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, Env,
};

/// Helper function to create and initialize a test token
fn create_test_token<'a>(env: &Env, admin: &Address) -> (token::StellarAssetClient<'a>, Address) {
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_admin_client = token::StellarAssetClient::new(env, &token_address);
    (token_admin_client, token_address)
}

/// Helper function to create token client + admin + address
fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>, Address) {
    let (token_admin, token_address) = create_test_token(env, admin);
    let token_client = token::Client::new(env, &token_address);
    (token_client, token_admin, token_address)
}

fn create_test_contract<'a>(
    env: &Env,
    admin: &Address,
    treasury: &Address,
    fee_bps: Option<i128>,
) -> (VaultixEscrowClient<'a>, Address) {
    let operator = Address::generate(env);
    let arbitrator = Address::generate(env);
    let contract_id = env.register(
        VaultixEscrow,
        (admin, &operator, &arbitrator, treasury, fee_bps),
    );
    let client = VaultixEscrowClient::new(env, &contract_id);
    (client, contract_id)
}

fn valid_metadata_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

#[test]
fn test_set_token_fee_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, _contract_id) = create_test_contract(&env, &admin, &treasury, Some(50));

    let (_token_client, _token_admin, token_address) = create_token_contract(&env, &admin);

    // Set token fee to 100 bps (1%)
    let result = client.try_set_token_fee(&token_address, &100);
    assert!(result.is_ok());
}

#[test]
fn test_set_token_fee_invalid_fee_too_high() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, _contract_id) = create_test_contract(&env, &admin, &treasury, Some(50));

    let (_token_client, _token_admin, token_address) = create_token_contract(&env, &admin);

    // Try to set token fee above BPS_DENOMINATOR (10000)
    let result = client.try_set_token_fee(&token_address, &10001);
    assert_eq!(result, Err(Ok(Error::InvalidFeeConfiguration)));
}

#[test]
fn test_set_escrow_fee_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, _contract_id) = create_test_contract(&env, &admin, &treasury, Some(50));

    let escrow_id = 1u64;

    // Set escrow-specific fee to 75 bps (0.75%)
    let result = client.try_set_escrow_fee(&escrow_id, &75);
    assert!(result.is_ok());
}

#[test]
fn test_set_escrow_fee_invalid_fee_too_high() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, _contract_id) = create_test_contract(&env, &admin, &treasury, Some(50));

    let escrow_id = 1u64;

    // Try to set escrow fee above BPS_DENOMINATOR
    let result = client.try_set_escrow_fee(&escrow_id, &10001);
    assert_eq!(result, Err(Ok(Error::InvalidFeeConfiguration)));
}

#[test]
fn test_release_milestone_uses_global_fee_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(100)); // 1% fee

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    let escrow_id = 1u64;
    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(&env),
    );

    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);

    // Release milestone using global fee (100 bps = 1%)
    client.release_milestone(&escrow_id, &0);

    // Expected: fee = 10_000 * 100 / 10_000 = 100
    let expected_fee = 100i128;
    let expected_payout = 10_000i128 - expected_fee;

    assert_eq!(token_client.balance(&recipient), expected_payout);
    assert_eq!(token_client.balance(&treasury), expected_fee);
}

#[test]
fn test_release_milestone_uses_token_fee_override() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(50)); // 0.5% global fee

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    // Set token-specific fee to 200 bps (2%)
    client.set_token_fee(&token_address, &200);

    let escrow_id = 1u64;
    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(&env),
    );

    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);

    // Release milestone - should use token fee (200 bps), not global (50 bps)
    client.release_milestone(&escrow_id, &0);

    // Expected: fee = 10_000 * 200 / 10_000 = 200
    let expected_fee = 200i128;
    let expected_payout = 10_000i128 - expected_fee;

    assert_eq!(token_client.balance(&recipient), expected_payout);
    assert_eq!(token_client.balance(&treasury), expected_fee);
}

#[test]
fn test_release_milestone_uses_escrow_fee_override() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(50)); // 0.5% global fee

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    // Set token-specific fee to 100 bps (1%)
    client.set_token_fee(&token_address, &100);

    let escrow_id = 1u64;

    // Set escrow-specific fee to 300 bps (3%) - highest priority
    client.set_escrow_fee(&escrow_id, &300);

    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(&env),
    );

    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);

    // Release milestone - should use escrow fee (300 bps), not token (100 bps) or global (50 bps)
    client.release_milestone(&escrow_id, &0);

    // Expected: fee = 10_000 * 300 / 10_000 = 300
    let expected_fee = 300i128;
    let expected_payout = 10_000i128 - expected_fee;

    assert_eq!(token_client.balance(&recipient), expected_payout);
    assert_eq!(token_client.balance(&treasury), expected_fee);
}

#[test]
fn test_fee_precedence_escrow_over_token_and_global() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(50)); // 0.5% global

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    // Set token fee to 100 bps
    client.set_token_fee(&token_address, &100);

    let escrow_id = 1u64;
    // Set escrow fee to 250 bps (should override token and global)
    client.set_escrow_fee(&escrow_id, &250);

    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(&env),
    );

    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);
    client.release_milestone(&escrow_id, &0);

    // Escrow fee (250 bps) should be used: 10_000 * 250 / 10_000 = 250
    let expected_fee = 250i128;
    let expected_payout = 10_000i128 - expected_fee;

    assert_eq!(token_client.balance(&recipient), expected_payout);
    assert_eq!(token_client.balance(&treasury), expected_fee);
}

#[test]
fn test_cancel_escrow_uses_token_fee_override() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(50)); // 0.5% global fee

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    // Set token-specific fee to 200 bps (2%)
    client.set_token_fee(&token_address, &200);

    let escrow_id = 1u64;
    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(&env),
    );

    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);

    // Cancel escrow - should use token fee (200 bps)
    client.cancel_escrow(&escrow_id);

    // Expected: fee = 10_000 * 200 / 10_000 = 200
    let expected_fee = 200i128;
    let expected_refund = 10_000i128 - expected_fee;

    assert_eq!(token_client.balance(&depositor), expected_refund);
    assert_eq!(token_client.balance(&treasury), expected_fee);
}

#[test]
fn test_refund_expired_uses_escrow_fee_override() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(50)); // 0.5% global fee

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    let escrow_id = 1u64;

    // Set escrow fee to 500 bps (5%)
    client.set_escrow_fee(&escrow_id, &500);

    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    let deadline = env.ledger().timestamp() + 100;
    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &deadline,
        &valid_metadata_hash(&env),
    );

    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);

    // Move time forward to expire the escrow
    env.ledger().with_mut(|ledger| {
        ledger.timestamp = deadline + 1000;
    });

    // Refund expired escrow - should use escrow fee (500 bps)
    client.refund_expired(&escrow_id, &depositor);

    // Expected: fee = 10_000 * 500 / 10_000 = 500
    let expected_fee = 500i128;
    let expected_refund = 10_000i128 - expected_fee;

    assert_eq!(token_client.balance(&depositor), expected_refund);
    assert_eq!(token_client.balance(&treasury), expected_fee);
}

#[test]
fn test_zero_fee_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, contract_id) = create_test_contract(&env, &admin, &treasury, Some(50));

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_client, token_admin, token_address) = create_token_contract(&env, &admin);
    token_admin.mint(&depositor, &10_000);

    // Set token fee to zero
    client.set_token_fee(&token_address, &0);

    let escrow_id = 1u64;
    let milestones = vec![
        &env,
        Milestone {
            amount: 10_000,
            status: MilestoneStatus::Pending,
            description: symbol_short!("Work"),
        },
    ];

    client.create_escrow(
        &escrow_id,
        &depositor,
        &recipient,
        &token_address,
        &milestones,
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(&env),
    );

    // Approve contract to transfer depositor's tokens, then deposit
    token_client.approve(&depositor, &contract_id, &10_000, &200);
    client.deposit_funds(&escrow_id);
    client.release_milestone(&escrow_id, &0);

    // With zero fee, recipient gets full amount
    assert_eq!(token_client.balance(&recipient), 10_000i128);
    assert_eq!(token_client.balance(&treasury), 0i128);
}

#[test]
fn test_max_fee_10000_bps_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let treasury = Address::generate(&env);
    let admin = Address::generate(&env);
    let (client, _contract_id) = create_test_contract(&env, &admin, &treasury, Some(50));

    let (_token_client, _token_admin, token_address) = create_token_contract(&env, &admin);

    // Set token fee to maximum valid value (BPS_DENOMINATOR = 10000)
    let result = client.try_set_token_fee(&token_address, &10000);
    assert!(result.is_ok());
}

#[test]
fn test_fee_rounding_tiny_amount_one_bps() {
    let amount: i128 = 1;
    let fee_bps: i128 = 1;

    let fee = amount * fee_bps / 10000;
    let payout = amount - fee;

    assert_eq!(fee, 0);
    assert_eq!(payout, 1);
    assert!(payout >= 0);
}

#[test]
fn test_fee_rounding_tiny_amount_max_bps() {
    let amount: i128 = 1;
    let fee_bps: i128 = 10000;

    let fee = amount * fee_bps / 10000;
    let payout = amount - fee;

    assert_eq!(fee, 1);
    assert_eq!(payout, 0);
    assert!(payout >= 0);
}

#[test]
fn test_fee_rounding_down_for_fractional_fee() {
    let amount: i128 = 333;
    let fee_bps: i128 = 100;

    let fee = amount * fee_bps / 10000;
    let payout = amount - fee;

    assert_eq!(fee, 3);
    assert_eq!(payout, 330);
    assert!(payout >= 0);
}

#[test]
fn test_fee_never_exceeds_amount_at_edge_bps() {
    let amount: i128 = 9999;
    let fee_bps: i128 = 9999;

    let fee = amount * fee_bps / 10000;
    let payout = amount - fee;

    assert!(fee <= amount);
    assert!(payout >= 0);
}

// --- Issue #735: resolve_dispute charges the platform fee ---

/// Creates and funds escrow 1 with a single milestone of `amount`, raises a
/// dispute, and returns (client, token, treasury, depositor, recipient).
fn setup_disputed_escrow<'a>(
    env: &Env,
    global_fee_bps: i128,
    amount: i128,
    token_fee_bps: Option<i128>,
    escrow_fee_bps: Option<i128>,
) -> (
    VaultixEscrowClient<'a>,
    token::Client<'a>,
    Address,
    Address,
    Address,
) {
    env.mock_all_auths();
    let treasury = Address::generate(env);
    let admin = Address::generate(env);
    let (client, contract_id) = create_test_contract(env, &admin, &treasury, Some(global_fee_bps));

    let depositor = Address::generate(env);
    let recipient = Address::generate(env);
    let (token_client, token_admin, token_address) = create_token_contract(env, &admin);
    token_admin.mint(&depositor, &amount);

    if let Some(bps) = token_fee_bps {
        client.set_token_fee(&token_address, &bps);
    }

    client.create_escrow(
        &1u64,
        &depositor,
        &recipient,
        &token_address,
        &vec![
            env,
            Milestone {
                amount,
                status: MilestoneStatus::Pending,
                description: symbol_short!("Work"),
            },
        ],
        &(env.ledger().timestamp() + 3600),
        &valid_metadata_hash(env),
    );
    if let Some(bps) = escrow_fee_bps {
        client.set_escrow_fee(&1u64, &bps);
    }
    token_client.approve(&depositor, &contract_id, &amount, &200);
    client.deposit_funds(&1u64);
    client.raise_dispute(&1u64, &depositor, &BytesN::from_array(env, &[5u8; 32]));

    (client, token_client, treasury, depositor, recipient)
}

#[test]
fn test_resolve_dispute_full_recipient_charges_fee() {
    let env = Env::default();
    let (client, token, treasury, depositor, recipient) =
        setup_disputed_escrow(&env, 100, 10_000, None, None); // 1%
    client.resolve_dispute(&1u64, &recipient, &None, &None);

    assert_eq!(token.balance(&treasury), 100);
    assert_eq!(token.balance(&recipient), 9_900);
    assert_eq!(token.balance(&depositor), 0);
}

#[test]
fn test_resolve_dispute_full_depositor_charges_fee() {
    let env = Env::default();
    let (client, token, treasury, depositor, recipient) =
        setup_disputed_escrow(&env, 100, 10_000, None, None);
    client.resolve_dispute(&1u64, &depositor, &None, &None);

    assert_eq!(token.balance(&treasury), 100);
    assert_eq!(token.balance(&depositor), 9_900);
    assert_eq!(token.balance(&recipient), 0);
}

#[test]
fn test_resolve_dispute_split_charges_fee_on_total_outstanding() {
    // Rounding case: fee(999) = 4 at 50 bps; winner bears fee(666) = 3, the
    // other share bears the remaining 1 — total equals a single-shot fee.
    let env = Env::default();
    let (client, token, treasury, depositor, recipient) =
        setup_disputed_escrow(&env, 50, 999, None, None);
    client.resolve_dispute(&1u64, &recipient, &Some(666), &None);

    assert_eq!(token.balance(&treasury), 4);
    assert_eq!(token.balance(&recipient), 663);
    assert_eq!(token.balance(&depositor), 332);
    assert_eq!(
        token.balance(&treasury) + token.balance(&recipient) + token.balance(&depositor),
        999
    );
}

#[test]
fn test_resolve_dispute_fee_precedence_escrow_over_token_over_global() {
    // Token override (200 bps) beats global (50 bps).
    let env = Env::default();
    let (client, token, treasury, _depositor, recipient) =
        setup_disputed_escrow(&env, 50, 10_000, Some(200), None);
    client.resolve_dispute(&1u64, &recipient, &None, &None);
    assert_eq!(token.balance(&treasury), 200);
    assert_eq!(token.balance(&recipient), 9_800);

    // Escrow override (300 bps) beats token (200 bps) and global (50 bps).
    let env = Env::default();
    let (client, token, treasury, _depositor, recipient) =
        setup_disputed_escrow(&env, 50, 10_000, Some(200), Some(300));
    client.resolve_dispute(&1u64, &recipient, &None, &None);
    assert_eq!(token.balance(&treasury), 300);
    assert_eq!(token.balance(&recipient), 9_700);
}

#[test]
fn test_resolve_dispute_zero_fee_pays_out_in_full() {
    let env = Env::default();
    let (client, token, treasury, _depositor, recipient) =
        setup_disputed_escrow(&env, 0, 10_000, None, None);
    client.resolve_dispute(&1u64, &recipient, &None, &None);

    assert_eq!(token.balance(&treasury), 0);
    assert_eq!(token.balance(&recipient), 10_000);
}
