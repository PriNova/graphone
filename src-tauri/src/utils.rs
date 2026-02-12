use std::sync::atomic::{AtomicU64, Ordering};

pub fn crypto_random_uuid() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        counter >> 32,
        (counter >> 16) & 0xffff,
        (counter >> 8) & 0xffff,
        counter & 0xffff,
        counter
    )
}
