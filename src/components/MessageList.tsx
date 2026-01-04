import { useEffect, useRef, useState } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string | any;
  timestamp: number;
  screenshot?: string;
  isStreaming?: boolean;
}

interface MessageListProps {
  messages: Message[];
}

function MessageList({ messages }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

      // If user scrolled away from bottom, mark as user scrolling
      if (!isAtBottom) {
        setIsUserScrolling(true);
      } else {
        setIsUserScrolling(false);
      }

      // Clear previous timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Reset user scrolling after 2 seconds of no scroll activity at bottom
      if (isAtBottom) {
        scrollTimeoutRef.current = window.setTimeout(() => {
          setIsUserScrolling(false);
        }, 2000);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Only auto-scroll if user is not actively scrolling
    if (!isUserScrolling) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isUserScrolling]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const parseContent = (text: string) => {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];

    // Try multiple regex patterns for code blocks
    // Pattern 1: ```language\ncode```
    // Pattern 2: ```\ncode```
    // Pattern 3: ```code```
    const patterns = [
      /```(\w+)\s*\n([\s\S]*?)```/g,  // with language and newline
      /```\s*\n([\s\S]*?)```/g,        // just newline, no language
      /```([\s\S]*?)```/g              // no newline
    ];

    let foundMatches = false;
    let lastIndex = 0;

    // Try each pattern
    for (const pattern of patterns) {
      pattern.lastIndex = 0; // Reset regex
      const matches = [...text.matchAll(pattern)];

      if (matches.length > 0) {
        foundMatches = true;
        lastIndex = 0;

        for (const match of matches) {
          // Add text before code block
          if (match.index! > lastIndex) {
            const textContent = text.slice(lastIndex, match.index).trim();
            if (textContent) {
              parts.push({ type: 'text', content: textContent });
            }
          }

          // Determine language and code content based on capture groups
          let language = 'plaintext';
          let codeContent = '';

          if (match.length === 3) {
            // Pattern with language
            language = match[1] || 'plaintext';
            codeContent = match[2];
          } else if (match.length === 2) {
            // Pattern without language
            codeContent = match[1];
          }

          if (codeContent) {
            parts.push({
              type: 'code',
              content: codeContent, // Don't trim - preserve formatting
              language
            });
          }

          lastIndex = match.index! + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
          const remaining = text.slice(lastIndex).trim();
          if (remaining) {
            parts.push({ type: 'text', content: remaining });
          }
        }

        break; // Found matches, stop trying other patterns
      }
    }

    // If no code blocks found, return all as text
    if (!foundMatches && text.trim()) {
      parts.push({ type: 'text', content: text });
    }

    return parts;
  };

  const processInlineCode = (text: string) => {
    const parts: Array<{ type: 'text' | 'inline-code'; content: string }> = [];
    const inlineCodeRegex = /`([^`]+)`/g;
    let lastIndex = 0;
    let match;

    while ((match = inlineCodeRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'inline-code', content: match[1] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    if (parts.length === 0) {
      parts.push({ type: 'text', content: text });
    }

    return parts;
  };

  const stripMarkdown = (text: string) => {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')  // Bold **text**
      .replace(/\*(.+?)\*/g, '$1')      // Italic *text*
      .replace(/\_\_(.+?)\_\_/g, '$1')  // Bold __text__
      .replace(/\_(.+?)\_/g, '$1')      // Italic _text_
      .replace(/\#+ /g, '')             // Headers # ## ###
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Links [text](url)
      .replace(/\!\[.*?\]\(.+?\)/g, '') // Images ![alt](url)
      .replace(/^\> /gm, '')            // Blockquotes
      .replace(/^\* /gm, '• ')          // Lists with *
      .replace(/^\- /gm, '• ')          // Lists with -
      .replace(/^\+ /gm, '• ');         // Lists with +
  };

  const renderTextWithInlineCode = (text: string) => {
    const parts = processInlineCode(text);
    return (
      <>
        {parts.map((part, idx) => {
          if (part.type === 'inline-code') {
            return (
              <code key={idx} className="inline-code">
                {part.content}
              </code>
            );
          }
          return <span key={idx}>{part.content}</span>;
        })}
      </>
    );
  };

  const formatTextPart = (text: string) => {
    // Strip markdown from text (but keep inline code for now)
    const cleaned = stripMarkdown(text);

    // If content already has double newlines, split by them
    if (cleaned.includes('\n\n')) {
      const paragraphs = cleaned.split('\n\n').filter(p => p.trim());
      return paragraphs.map((para, idx) => (
        <p key={idx} style={{ marginBottom: '12px', lineHeight: '1.6' }}>
          {renderTextWithInlineCode(para.trim())}
        </p>
      ));
    }

    // Otherwise, split by single newlines or by sentence groups
    const lines = cleaned.split('\n').filter(l => l.trim());

    if (lines.length > 1) {
      return lines.map((line, idx) => (
        <p key={idx} style={{ marginBottom: '12px', lineHeight: '1.6' }}>
          {renderTextWithInlineCode(line.trim())}
        </p>
      ));
    }

    // For single long paragraph, split by periods to create readable chunks
    const textContent = cleaned.trim();
    if (!textContent) return null;

    const sentences = textContent.match(/[^.!?]+[.!?]+/g) || [textContent];

    // Group sentences into paragraphs (every 3-4 sentences)
    const paragraphs: string[] = [];
    for (let i = 0; i < sentences.length; i += 3) {
      const chunk = sentences.slice(i, i + 3).join(' ').trim();
      if (chunk) paragraphs.push(chunk);
    }

    return paragraphs.map((para, idx) => (
      <p key={idx} style={{ marginBottom: '12px', lineHeight: '1.6' }}>
        {renderTextWithInlineCode(para)}
      </p>
    ));
  };

  const formatCodeContent = (code: string, language: string) => {
    // If code already has newlines, return as is
    if (code.includes('\n')) {
      return code;
    }

    // For Python and similar languages, try to add newlines based on patterns
    let formatted = code;

    // For Python-like languages
    if (language === 'python' || language === 'py') {
      // Replace patterns that indicate new lines
      formatted = formatted.replace(/(\))(\s*)(def |class |if |elif |else:|for |while |try:|except |finally:|with |return |import |from )/g, ')\n$2$3');
      formatted = formatted.replace(/(:\s{2,})(\S)/g, ':\n    $2'); // After colon with spaces
      formatted = formatted.replace(/(\S)(\s{4,})(\S)/g, '$1\n    $3'); // Multiple spaces = new line with indent
    }

    // For general code, split by common keywords
    formatted = formatted.replace(/(;)(\s*)(\w)/g, '$1\n$2$3'); // Semicolons
    formatted = formatted.replace(/(\{)(\s*)(\w)/g, '$1\n$2$3'); // Opening braces
    formatted = formatted.replace(/(\})(\s*)(\w)/g, '$1\n$2$3'); // Closing braces

    return formatted;
  };

  const formatContent = (content: string) => {
    const parts = parseContent(content);

    return (
      <div>
        {parts.map((part, idx) => {
          if (part.type === 'code') {
            const formattedCode = formatCodeContent(part.content, part.language || 'plaintext');

            return (
              <pre key={idx} className="code-block">
                <code className={`language-${part.language}`}>{formattedCode}</code>
              </pre>
            );
          } else {
            return <div key={idx}>{formatTextPart(part.content)}</div>;
          }
        })}
      </div>
    );
  };

  return (
    <div className="message-list" ref={containerRef}>
      {messages.length === 0 ? (
        <div className="empty-state">
          <p>Phantom is ready to assist</p>
          <p className="hint">
            Press Cmd+Shift+G to show/hide
            <br />
            Click Screenshot to analyze your screen
          </p>
        </div>
      ) : (
        messages.map((msg, idx) => (
          <div key={idx} className={`message message-${msg.role}`}>
            <div className="message-header">
              <span className="role">
                {msg.role === 'user' ? 'User' : 'AI'}
              </span>
              <span className="timestamp">{formatTime(msg.timestamp)}</span>
            </div>
            {msg.screenshot && (
              <div className="message-screenshot">
                <img
                  src={`data:image/png;base64,${msg.screenshot}`}
                  alt="Screenshot"
                />
              </div>
            )}
            <div className="message-content">
              {typeof msg.content === 'string' ? (
                msg.isStreaming ? (
                  <pre className="streaming-text">{msg.content}</pre>
                ) : (
                  formatContent(msg.content)
                )
              ) : (
                <p>{JSON.stringify(msg.content)}</p>
              )}
            </div>
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  );
}

export default MessageList;
