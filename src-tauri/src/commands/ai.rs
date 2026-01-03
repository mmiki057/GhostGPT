use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: MessageContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentPart {
    Text { text: String },
    ImageUrl { image_url: ImageUrl },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrl {
    pub url: String,
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<Message>,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ResponseMessage {
    content: String,
}

/// Send message to OpenAI API with optional screenshot
///
/// # Arguments
/// * `api_key` - OpenAI API key from state
/// * `messages` - Conversation history
/// * `screenshot_base64` - Optional base64-encoded screenshot
///
/// # Returns
/// Assistant's response text
#[tauri::command]
pub async fn send_message(
    api_key: tauri::State<'_, String>,
    messages: Vec<Message>,
    screenshot_base64: Option<String>,
) -> Result<String, String> {
    send_message_impl(&api_key, messages, screenshot_base64)
        .await
        .map_err(|e| format!("OpenAI API error: {}", e))
}

async fn send_message_impl(
    api_key: &str,
    mut messages: Vec<Message>,
    screenshot_base64: Option<String>,
) -> Result<String> {
    // If screenshot provided, append to last user message
    if let Some(base64_data) = screenshot_base64 {
        if let Some(last_msg) = messages.last_mut() {
            if last_msg.role == "user" {
                // Convert to multi-part message with text + image
                let text = match &last_msg.content {
                    MessageContent::Text(t) => t.clone(),
                    MessageContent::Parts(_) => String::from("Analyze this screenshot"),
                };

                last_msg.content = MessageContent::Parts(vec![
                    ContentPart::Text { text },
                    ContentPart::ImageUrl {
                        image_url: ImageUrl {
                            url: format!("data:image/png;base64,{}", base64_data),
                        },
                    },
                ]);
            }
        }
    }

    let request = OpenAIRequest {
        model: String::from("gpt-4o"),
        messages,
        max_tokens: 1000,
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .context("Failed to send request to OpenAI")?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        anyhow::bail!("OpenAI API returned error {}: {}", status, error_text);
    }

    let openai_response: OpenAIResponse = response
        .json()
        .await
        .context("Failed to parse OpenAI response")?;

    openai_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .context("No response from OpenAI")
}
