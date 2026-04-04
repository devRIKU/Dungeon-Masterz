import React, { useLayoutEffect, useRef } from 'react';

type StoryViewportProps = {
  text: string;
  className?: string;
};

export default function StoryViewport({ text, className = '' }: StoryViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scale = 1.0;
    const minScale = 0.65; // Minimum size bound

    // Reset before measuring
    container.style.setProperty('--font-scale', '1');

    // Iterate until height fits or bound reached (text fit system)
    while (container.scrollHeight > container.clientHeight && scale > minScale) {
      scale -= 0.05;
      container.style.setProperty('--font-scale', scale.toString());
    }
  }, [text]);

  if (!text || !text.trim()) {
    return (
      <div className={`story-viewport-shell ${className}`}>
        <div className="story-text-content story-text-content--loading">
          <p>Listening for the next omen...</p>
        </div>
      </div>
    );
  }

  // Split text by newlines into paragraphs
  const paragraphs = text.split(/\r?\n+/).filter((p) => p.trim() !== '');

  return (
    <div ref={containerRef} className={`story-viewport-shell ${className}`}>
      <div className="story-text-content">
        {paragraphs.map((p, idx) => (
          <p key={idx}>{p}</p>
        ))}
      </div>
    </div>
  );
}

