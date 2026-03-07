use uuid::Uuid;

pub fn crypto_random_uuid() -> String {
    Uuid::new_v4().to_string()
}
