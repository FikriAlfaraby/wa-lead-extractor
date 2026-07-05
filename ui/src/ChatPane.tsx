import { useEffect, useRef } from "react";
import type { Message } from "@pipeline/schema";

interface ChatPaneProps {
  leadName: string;
  baseTime: Date;
  messages: Message[];
  typingSpeaker: "lead" | "agent" | null;
  highlightedIndex: number | null;
}

function formatTimestamp(baseTime: Date, index: number): string {
  const t = new Date(baseTime.getTime() + index * 2 * 60_000);
  return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatPane({ leadName, baseTime, messages, typingSpeaker, highlightedIndex }: ChatPaneProps) {
  const bubbleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, typingSpeaker]);

  useEffect(() => {
    if (highlightedIndex === null) return;
    bubbleRefs.current[highlightedIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedIndex]);

  return (
    <div className="chat-pane">
      <div className="chat-pane__header">{leadName}</div>
      <div className="chat-pane__scroll" ref={scrollRef}>
        {messages.map((message, i) => (
          <div
            key={i}
            ref={(el) => {
              bubbleRefs.current[i] = el;
            }}
            className={`chat-bubble chat-bubble--${message.speaker} ${
              highlightedIndex === i ? "chat-bubble--highlight" : ""
            }`}
          >
            <p>{message.text}</p>
            <span className="chat-bubble__time">{formatTimestamp(baseTime, i)}</span>
          </div>
        ))}
        {typingSpeaker && (
          <div className={`chat-bubble chat-bubble--${typingSpeaker} chat-bubble--typing`}>
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}
