use anyhow::{Context, Result};

/// Capture screenshot of the main display and return base64-encoded PNG
/// Returns base64 string suitable for OpenAI Vision API
#[tauri::command]
pub async fn capture_screenshot() -> Result<String, String> {
    capture_screenshot_impl()
        .await
        .map_err(|e| format!("Screenshot failed: {}", e))
}

#[cfg(target_os = "macos")]
async fn capture_screenshot_impl() -> Result<String> {
    use std::process::Command;

    // Use native macOS screencapture utility for reliability
    // This avoids complex CoreGraphics API and permission issues
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let temp_path = temp_dir.join(format!("phantom_screenshot_{}.png", timestamp));

    // Capture screenshot using macOS screencapture command
    let output = Command::new("screencapture")
        .arg("-x") // Don't play sound
        .arg("-m") // Main display only
        .arg(&temp_path)
        .output()
        .context("Failed to execute screencapture command")?;

    if !output.status.success() {
        anyhow::bail!("screencapture command failed: {:?}", output.stderr);
    }

    // Read the PNG file
    let png_data = std::fs::read(&temp_path)
        .context("Failed to read screenshot file")?;

    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);

    // Return base64-encoded PNG
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_data))
}

#[cfg(not(target_os = "macos"))]
async fn capture_screenshot_impl() -> Result<String> {
    anyhow::bail!("Screenshot capture is only supported on macOS")
}
