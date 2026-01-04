import { useState, useRef, useEffect, useCallback } from 'react';
import MessageList from './components/MessageList';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  screenshot?: string;
  isStreaming?: boolean;
}

const API_URL = 'http://localhost:5001';

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }, []);

  const toggleVoiceRecording = useCallback(async () => {
    if (isLoading) return;

    if (!isRecording) {
      // Start recording
      try {
        setError(null);
        const response = await fetch(`${API_URL}/start_recording`, { method: 'POST' });
        const data = await response.json();

        if (!response.ok || data.status !== 'recording started') {
          throw new Error(data.message || 'Failed to start recording');
        }

        setIsRecording(true);
      } catch (err: any) {
        setError('Failed to start recording: ' + err.message);
      }
    } else {
      // Stop recording and process
      try {
        setIsRecording(false);
        setIsLoading(true);

        // Stop the recording
        await fetch(`${API_URL}/stop_recording`, { method: 'POST' });

        // Process audio (transcribe)
        const response = await fetch(`${API_URL}/process_audio`, { method: 'POST' });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to process audio');
        }

        const transcription = data.transcription;
        if (!transcription || !transcription.trim()) {
          setError('No speech detected');
          setIsLoading(false);
          return;
        }

        // Add user message
        const userMessage: Message = {
          role: 'user',
          content: transcription,
          timestamp: Date.now(),
        };

        const updatedMessages = [...messages, userMessage];
        setMessages(updatedMessages);

        // Create abort controller for stopping
        abortControllerRef.current = new AbortController();

        // Send to ChatGPT with streaming
        const chatResponse = await fetch(`${API_URL}/send_message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
            screenshotBase64: null
          }),
          signal: abortControllerRef.current.signal
        });

        if (!chatResponse.ok) {
          throw new Error('Failed to send message');
        }

        // Create assistant message (streaming)
        const assistantMessage: Message = {
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true
        };

        const messagesWithAssistant = [...updatedMessages, assistantMessage];
        setMessages(messagesWithAssistant);

        const reader = chatResponse.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedContent = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  // Stream complete - mark as no longer streaming
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastMsg = updated[updated.length - 1];
                    if (lastMsg.role === 'assistant') {
                      lastMsg.isStreaming = false;
                    }
                    return updated;
                  });
                  break;
                }

                try {
                  const parsed = JSON.parse(data);
                  if (parsed.error) {
                    throw new Error(parsed.error);
                  }
                  if (parsed.content) {
                    accumulatedContent += parsed.content;

                    // Update message content (still streaming)
                    setMessages(prev => {
                      const updated = [...prev];
                      const lastMsg = updated[updated.length - 1];
                      if (lastMsg.role === 'assistant') {
                        lastMsg.content = accumulatedContent;
                      }
                      return updated;
                    });
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Generation was stopped by user
          console.log('Generation stopped by user');
        } else {
          setError('Error: ' + err.message);
        }
      } finally {
        abortControllerRef.current = null;
        setIsLoading(false);
        inputRef.current?.focus();
      }
    }
  }, [isRecording, isLoading, messages]);

  useEffect(() => {
    inputRef.current?.focus();

    // Listen for Cmd+Enter to toggle recording
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'Enter') {
        e.preventDefault();
        toggleVoiceRecording();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleVoiceRecording]);

  const captureScreenshot = async (): Promise<string | null> => {
    try {
      setError(null);
      const response = await fetch(`${API_URL}/capture_screenshot`, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to capture screenshot');
      }

      return data.screenshot;
    } catch (err: any) {
      setError(`Screenshot failed: ${err.message}`);
      return null;
    }
  };

  const sendMessage = async (withScreenshot: boolean = false) => {
    if ((!input.trim() && !withScreenshot) || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      let screenshotBase64: string | null = null;

      if (withScreenshot) {
        screenshotBase64 = await captureScreenshot();
        if (!screenshotBase64) {
          setIsLoading(false);
          return;
        }
      }

      const userMessage: Message = {
        role: 'user',
        content: input.trim() || 'Analyze this screenshot',
        timestamp: Date.now(),
        screenshot: screenshotBase64 || undefined,
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInput('');

      // Create abort controller for stopping
      abortControllerRef.current = new AbortController();

      // Send to ChatGPT with streaming
      const response = await fetch(`${API_URL}/send_message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          screenshotBase64
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Create assistant message (streaming)
      const assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true
      };

      const messagesWithAssistant = [...updatedMessages, assistantMessage];
      setMessages(messagesWithAssistant);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                // Stream complete - mark as no longer streaming
                setMessages(prev => {
                  const updated = [...prev];
                  const lastMsg = updated[updated.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.isStreaming = false;
                  }
                  return updated;
                });
                break;
              }

              try {
                const parsed = JSON.parse(data);
                if (parsed.error) {
                  throw new Error(parsed.error);
                }
                if (parsed.content) {
                  accumulatedContent += parsed.content;

                  // Update message content (still streaming)
                  setMessages(prev => {
                    const updated = [...prev];
                    const lastMsg = updated[updated.length - 1];
                    if (lastMsg.role === 'assistant') {
                      lastMsg.content = accumulatedContent;
                    }
                    return updated;
                  });
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Generation was stopped by user
        console.log('Generation stopped by user');
      } else {
        setError(`Error: ${err.message}`);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(false);
    }
  };

  return (
    <div className="app-container">
      <div className="window-header" data-tauri-drag-region>
        <h1>Phantom</h1>
        <div className="status">
          {isLoading ? 'Thinking...' : isRecording ? 'Recording...' : 'Ready'}
        </div>
      </div>

      <MessageList messages={messages} />

      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      <div className="input-container">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "Recording... (Cmd+Enter to stop)" : "Type or Cmd+Enter to record voice..."}
          disabled={isLoading || isRecording}
          rows={2}
        />
        <div className="button-group">
          {isLoading ? (
            <button
              onClick={stopGeneration}
              className="btn-stop"
            >
              Stop
            </button>
          ) : isRecording ? (
            <button
              onClick={toggleVoiceRecording}
              className="btn-recording"
            >
              Stop Recording
            </button>
          ) : (
            <>
              <button
                onClick={() => sendMessage(false)}
                disabled={!input.trim()}
                className="btn-primary"
              >
                Send Text
              </button>
              <button
                onClick={toggleVoiceRecording}
                className="btn-voice"
              >
                Voice
              </button>
              <button
                onClick={() => sendMessage(true)}
                className="btn-secondary"
              >
                Screenshot
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
