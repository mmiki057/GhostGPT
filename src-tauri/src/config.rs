use std::env;

/// Application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub openai_api_key: String,
}

impl AppConfig {
    /// Load configuration from environment variables
    /// Automatically loads .env file if present
    /// Panics if OPENAI_API_KEY is not set after loading .env
    pub fn from_env() -> Self {
        // Try to load .env file (silently ignore if not found)
        let _ = dotenvy::dotenv();

        let openai_api_key = env::var("OPENAI_API_KEY")
            .expect("OPENAI_API_KEY not found. Create a .env file with: OPENAI_API_KEY=sk-your-key");

        Self { openai_api_key }
    }
}
