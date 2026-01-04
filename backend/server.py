#!/usr/bin/env python3
import os
import base64
import subprocess
import tempfile
import json
from pathlib import Path
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import pyaudio
import wave
import threading
import io
from openai import OpenAI

app = Flask(__name__)
CORS(app)

api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    raise ValueError("OPENAI_API_KEY environment variable not set")

client = OpenAI(api_key=api_key)

class AudioRecorder:
    def __init__(self):
        self.is_recording = False
        self.frames = []
        self.stream = None
        self.audio = None
        self.CHUNK = 1024
        self.FORMAT = pyaudio.paInt16
        self.CHANNELS = 1
        self.RATE = 44100

    def start_recording(self):
        if self.is_recording:
            return {"status": "already recording"}

        self.frames = []
        self.is_recording = True
        self.audio = pyaudio.PyAudio()

        try:
            self.stream = self.audio.open(
                format=self.FORMAT,
                channels=self.CHANNELS,
                rate=self.RATE,
                input=True,
                frames_per_buffer=self.CHUNK,
                stream_callback=self._audio_callback
            )
            self.stream.start_stream()
            return {"status": "recording started"}
        except Exception as e:
            self.is_recording = False
            return {"status": "error", "message": str(e)}

    def _audio_callback(self, in_data, frame_count, time_info, status):
        if self.is_recording:
            self.frames.append(in_data)
        return (in_data, pyaudio.paContinue)

    def stop_recording(self):
        if not self.is_recording:
            return {"status": "not recording"}

        self.is_recording = False
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
        if self.audio:
            self.audio.terminate()

        return {"status": "recording stopped"}

    def get_audio_data(self):
        """Get recorded audio as WAV bytes"""
        if not self.frames:
            return None

        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wf:
            wf.setnchannels(self.CHANNELS)
            wf.setsampwidth(self.audio.get_sample_size(self.FORMAT) if self.audio else 2)
            wf.setframerate(self.RATE)
            wf.writeframes(b''.join(self.frames))

        wav_buffer.seek(0)
        return wav_buffer.getvalue()

    def clear_buffer(self):
        self.frames = []

recorder = AudioRecorder()

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/start_recording', methods=['POST'])
def start_recording():
    result = recorder.start_recording()
    return jsonify(result)

@app.route('/stop_recording', methods=['POST'])
def stop_recording():
    result = recorder.stop_recording()
    return jsonify(result)

@app.route('/is_recording', methods=['GET'])
def is_recording():
    return jsonify({"is_recording": recorder.is_recording})

@app.route('/process_audio', methods=['POST'])
def process_audio():
    try:
        audio_data = recorder.get_audio_data()

        if not audio_data:
            return jsonify({"error": "No audio data"}), 400

        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
            temp_file.write(audio_data)
            temp_path = temp_file.name

        try:
            with open(temp_path, 'rb') as audio_file:
                transcription = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=audio_file
                )

            recorder.clear_buffer()

            return jsonify({"transcription": transcription.text})

        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/send_message', methods=['POST'])
def send_message():
    try:
        data = request.json
        messages = data.get('messages', [])
        screenshot_base64 = data.get('screenshotBase64')

        if not messages:
            return jsonify({"error": "No messages provided"}), 400

        api_messages = []
        for msg in messages:
            content = msg.get('content')
            role = msg.get('role')

            if screenshot_base64 and msg == messages[-1]:
                api_messages.append({
                    "role": role,
                    "content": [
                        {"type": "text", "text": content},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{screenshot_base64}"
                            }
                        }
                    ]
                })
            else:
                api_messages.append({
                    "role": role,
                    "content": content
                })

        # Use streaming and let frontend handle formatting
        def generate():
            try:
                response = client.chat.completions.create(
                    model="gpt-4o",
                    messages=api_messages,
                    stream=True
                )

                for chunk in response:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        yield f"data: {json.dumps({'content': content})}\n\n"

                yield "data: [DONE]\n\n"

            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(generate(), mimetype='text/event-stream')

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/capture_screenshot', methods=['POST'])
def capture_screenshot():
    """Capture screenshot on macOS"""
    try:
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as temp_file:
            temp_path = temp_file.name

        try:
            # Try different screencapture options
            # -x: no sound, -T: no shadow, -t: type
            result = subprocess.run(
                ['screencapture', '-x', '-T0', temp_path],
                capture_output=True,
                text=True,
                timeout=10
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() if result.stderr else "Unknown error"
                print(f"Screenshot error - return code: {result.returncode}")
                print(f"Screenshot error - stderr: {error_msg}")
                print(f"Screenshot error - stdout: {result.stdout}")

                # Provide helpful error message
                if "could not create image" in error_msg.lower():
                    return jsonify({
                        "error": "Screenshot failed: Please grant Screen Recording permission to Terminal in System Settings > Privacy & Security > Screen Recording"
                    }), 500

                return jsonify({"error": f"Screenshot failed: {error_msg}"}), 500

            # Check if file was created and has content
            if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
                return jsonify({"error": "Screenshot file not created"}), 500

            with open(temp_path, 'rb') as f:
                screenshot_data = f.read()

            base64_data = base64.b64encode(screenshot_data).decode('utf-8')
            return jsonify({"screenshot": base64_data})

        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Screenshot command timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("Phantom Backend Server Starting...")
    print(f"Running on http://localhost:5001")
    print(f"Recording mode: Manual (toggle with Cmd+Enter)")

    app.run(host='0.0.0.0', port=5001, debug=True, threaded=True)
