//! Password hashing and verification via Argon2.

use crate::AppError;
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};

/// Hash a plaintext password with Argon2id and a random salt.
pub fn hash(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Password(format!("Hashing failed: {e}")))?;
    Ok(hash.to_string())
}

/// Verify a plaintext password against a stored Argon2 hash string.
pub fn verify(password: &str, hash_str: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(hash_str)
        .map_err(|e| AppError::Password(format!("Invalid hash format: {e}")))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}
