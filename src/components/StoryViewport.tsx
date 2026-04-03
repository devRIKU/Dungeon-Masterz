import React, { useEffect, useMemo, useRef, useState } from 'react';
import { layoutWithLines, prepareWithSegments, type LayoutLinesResult, type PreparedTextWithSegments } from '@chenglou/pretext';

const STORY_FONT_FAMILY = '"Cormorant Garamond", Georgia, serif';
const STORY_FONT_WEIGHT = 600;
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 40;
const LINE_HEIGHT_RATIO = 1.38;

type StoryViewportProps = {
  text: string;
  className?: string;
};

type StoryLayout = {
  fontSize: number;
  lineHeight: number;
  lines: LayoutLinesResult['lines'];
};

const preparedCache = new Map<string, PreparedTextWithSegments>();

function getPrepared(text: string, font: string) {
  const key = `${font}__${text}`;
  const cached = preparedCache.get(key);
  if (cached) return cached;
  const prepared = prepareWithSegments(text, font, { whiteSpace: 'pre-wrap' });
  preparedCache.set(key, prepared);
  return prepared;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const next = {
        width: node.clientWidth,
        height: node.clientHeight,
      };
      setSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };

    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

function computeLayout(text: string, width: number, height: number) {
  if (!text.trim() || width <= 0 || height <= 0) {
    return null;
  }

  const fitForSize = (fontSize: number) => {
    const font = `${STORY_FONT_WEIGHT} ${fontSize}px ${STORY_FONT_FAMILY}`;
    const lineHeight = Math.max(Math.round(fontSize * LINE_HEIGHT_RATIO), fontSize + 6);
    const prepared = getPrepared(text, font);
    const layout = layoutWithLines(prepared, width, lineHeight);
    return {
      fontSize,
      lineHeight,
      lines: layout.lines,
      height: layout.height,
    };
  };

  let low = MIN_FONT_SIZE;
  let high = MAX_FONT_SIZE;
  let best = fitForSize(MIN_FONT_SIZE);

  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const candidate = fitForSize(mid);

    if (candidate.height <= height) {
      best = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }

  return best;
}

export default function StoryViewport({ text, className }: StoryViewportProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [isFontsReady, setIsFontsReady] = useState(typeof document === 'undefined');

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        setIsFontsReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const layout = useMemo<StoryLayout | null>(() => {
    if (!isFontsReady) return null;
    return computeLayout(text, Math.max(size.width - 4, 0), Math.max(size.height - 4, 0));
  }, [isFontsReady, size.height, size.width, text]);

  return (
    <div ref={ref} className={className}>
      {layout ? (
        <div
          className="pretext-story"
          style={{
            fontSize: `${layout.fontSize}px`,
            lineHeight: `${layout.lineHeight}px`,
          }}
        >
          {layout.lines.map((line, index) => (
            <div key={`${index}-${line.start.segmentIndex}-${line.start.graphemeIndex}`} className="pretext-story-line">
              {line.text}
            </div>
          ))}
        </div>
      ) : (
        <div className="pretext-story pretext-story--loading">
          <div className="pretext-story-line">Listening for the next omen...</div>
        </div>
      )}
    </div>
  );
}
