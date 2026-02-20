//! Chrome Native Messaging protocol.
//!
//! Messages are length-prefixed: a 4-byte unsigned integer in native byte order
//! followed by UTF-8 JSON of that length.

use crate::AppError;
use std::io::{Read, Write};

/// Maximum accepted message size (1 MiB). Chrome's own limit is 1 MB.
const MAX_MESSAGE_LEN: usize = 1024 * 1024;

/// Read one length-prefixed JSON message from the given reader.
pub fn read_message(reader: &mut impl Read) -> Result<serde_json::Value, AppError> {
    // 4-byte native-endian length prefix.
    let mut len_bytes = [0u8; 4];
    reader.read_exact(&mut len_bytes)?;
    let len = u32::from_ne_bytes(len_bytes) as usize;

    if len > MAX_MESSAGE_LEN {
        return Err(AppError::Messaging(format!(
            "Message too large: {len} bytes (max {MAX_MESSAGE_LEN})"
        )));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;

    serde_json::from_slice(&buf).map_err(|e| AppError::Messaging(format!("Invalid JSON: {e}")))
}

/// Write one length-prefixed JSON message to the given writer.
pub fn write_message(writer: &mut impl Write, msg: &serde_json::Value) -> Result<(), AppError> {
    let data = serde_json::to_vec(msg)?;
    writer.write_all(&(data.len() as u32).to_ne_bytes())?;
    writer.write_all(&data)?;
    writer.flush()?;
    Ok(())
}
