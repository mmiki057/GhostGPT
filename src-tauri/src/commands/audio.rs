use anyhow::{Context, Result};
use std::sync::{Arc, Mutex};
use tauri::State;

use std::sync::atomic::{AtomicBool, Ordering};

/// Global audio recorder state
pub struct AudioRecorder {
    is_recording: Arc<AtomicBool>,
    audio_buffer: Arc<Mutex<Vec<f32>>>,
    stream_started: Arc<AtomicBool>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            audio_buffer: Arc::new(Mutex::new(Vec::new())),
            stream_started: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::Relaxed)
    }

    pub fn get_audio_buffer(&self) -> Vec<f32> {
        self.audio_buffer.lock().unwrap().clone()
    }

    pub fn clear_buffer(&self) {
        self.audio_buffer.lock().unwrap().clear()
    }

    pub fn append_audio(&self, samples: Vec<f32>) {
        let mut buffer = self.audio_buffer.lock().unwrap();
        buffer.extend(samples);
    }

    pub fn set_recording(&self, recording: bool) {
        self.is_recording.store(recording, Ordering::Relaxed);
    }

    pub fn is_stream_started(&self) -> bool {
        self.stream_started.load(Ordering::Relaxed)
    }

    pub fn set_stream_started(&self, started: bool) {
        self.stream_started.store(started, Ordering::Relaxed);
    }
}

/// Start recording audio from microphone
#[tauri::command]
pub async fn start_audio_recording(
    recorder: State<'_, AudioRecorder>,
) -> Result<(), String> {
    start_microphone_recording(recorder.inner())
        .map_err(|e| format!("Failed to start recording: {}", e))
}

/// Stop recording audio
#[tauri::command]
pub async fn stop_audio_recording(
    recorder: State<'_, AudioRecorder>,
) -> Result<(), String> {
    recorder.set_recording(false);
    Ok(())
}

/// Get current recording status
#[tauri::command]
pub fn is_recording(recorder: State<'_, AudioRecorder>) -> bool {
    recorder.is_recording()
}

/// Process recorded audio: transcribe and return text
#[tauri::command]
pub async fn process_audio(
    recorder: State<'_, AudioRecorder>,
    api_key: State<'_, String>,
) -> Result<String, String> {
    // Get audio buffer
    let audio_samples = recorder.get_audio_buffer();

    if audio_samples.is_empty() {
        return Err("No audio recorded".to_string());
    }

    println!("Processing {} audio samples", audio_samples.len());

    // Convert to WAV format
    let wav_data = samples_to_wav(&audio_samples, 44100, 1)
        .map_err(|e| format!("Failed to encode audio: {}", e))?;

    println!("Encoded {} bytes of WAV data", wav_data.len());

    // Transcribe using Whisper
    let transcription = transcribe_audio_impl(&api_key, wav_data)
        .await
        .map_err(|e| format!("Transcription failed: {}", e))?;

    // Clear buffer for next recording
    recorder.clear_buffer();

    Ok(transcription)
}

fn start_microphone_recording(recorder: &AudioRecorder) -> Result<()> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    // Check if stream already started
    if recorder.is_stream_started() {
        println!("Stream already started, just resuming recording");
        recorder.set_recording(true);
        return Ok(());
    }

    // Set recording flag
    recorder.set_recording(true);
    recorder.clear_buffer();

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .context("No input device available")?;

    println!("Using input device: {:?}", device.name());

    let config = device.default_input_config()?;
    println!("Input config: {:?}", config);

    let recorder_clone = Arc::new(AudioRecorder {
        is_recording: Arc::clone(&recorder.is_recording),
        audio_buffer: Arc::clone(&recorder.audio_buffer),
        stream_started: Arc::clone(&recorder.stream_started),
    });

    // Create stream based on sample format
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let config: cpal::StreamConfig = config.into();
            device.build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if recorder_clone.is_recording() {
                        recorder_clone.append_audio(data.to_vec());
                    }
                },
                move |err| {
                    eprintln!("Audio stream error: {}", err);
                },
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let config: cpal::StreamConfig = config.into();
            device.build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if recorder_clone.is_recording() {
                        // Convert i16 to f32
                        let samples: Vec<f32> = data
                            .iter()
                            .map(|&sample| sample as f32 / i16::MAX as f32)
                            .collect();
                        recorder_clone.append_audio(samples);
                    }
                },
                move |err| {
                    eprintln!("Audio stream error: {}", err);
                },
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let config: cpal::StreamConfig = config.into();
            device.build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if recorder_clone.is_recording() {
                        // Convert u16 to f32
                        let samples: Vec<f32> = data
                            .iter()
                            .map(|&sample| (sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect();
                        recorder_clone.append_audio(samples);
                    }
                },
                move |err| {
                    eprintln!("Audio stream error: {}", err);
                },
                None,
            )?
        }
        _ => anyhow::bail!("Unsupported sample format: {:?}", config.sample_format()),
    };

    stream.play()?;

    // Mark stream as started
    recorder.set_stream_started(true);

    // Store stream in a thread so it doesn't get dropped
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    });

    Ok(())
}

/// Convert audio samples to WAV format
fn samples_to_wav(samples: &[f32], sample_rate: u32, channels: u16) -> Result<Vec<u8>> {
    use hound::{WavSpec, WavWriter};
    use std::io::Cursor;

    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)?;
        for &sample in samples {
            writer.write_sample(sample)?;
        }
        writer.finalize()?;
    }

    Ok(cursor.into_inner())
}

/// Transcribe audio using OpenAI Whisper API
async fn transcribe_audio_impl(api_key: &str, audio_data: Vec<u8>) -> Result<String> {
    use reqwest::multipart;

    let client = reqwest::Client::new();

    // Create multipart form with audio file
    let part = multipart::Part::bytes(audio_data)
        .file_name("audio.wav")
        .mime_str("audio/wav")?;

    let form = multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-1");

    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .context("Failed to send request to Whisper API")?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        anyhow::bail!("Whisper API returned error {}: {}", status, error_text);
    }

    #[derive(serde::Deserialize)]
    struct WhisperResponse {
        text: String,
    }

    let whisper_response: WhisperResponse = response
        .json()
        .await
        .context("Failed to parse Whisper response")?;

    Ok(whisper_response.text)
}

// Implement Clone for AudioRecorder
impl Clone for AudioRecorder {
    fn clone(&self) -> Self {
        Self {
            is_recording: Arc::clone(&self.is_recording),
            audio_buffer: Arc::clone(&self.audio_buffer),
            stream_started: Arc::clone(&self.stream_started),
        }
    }
}
