import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { HUD_AGENT_LINE_SLIDE_DURATION } from '@/lib/motion/hud-agent-line-timing';

import './hud-agent-line.css';

interface HudAgentLineProps {
  line: string;
}

/** One-line activity ticker. Its content comes from the agent. */
export function HudAgentLine({ line }: HudAgentLineProps) {
  const [rows, setRows] = useState(() => ({ previous: '', shown: line, sliding: true }));
  const shownLine = useRef(line);
  const pendingFrames = useRef(new Set<number>());

  useLayoutEffect(() => {
    const frames = pendingFrames.current;
    return () => {
      for (const frame of frames) cancelAnimationFrame(frame);
      frames.clear();
    };
  }, []);

  useLayoutEffect(() => {
    if (line === shownLine.current) return;
    const previous = shownLine.current;
    shownLine.current = line;
    setRows({ previous, shown: line, sliding: false });
    const first = requestAnimationFrame(() => {
      pendingFrames.current.delete(first);
      const second = requestAnimationFrame(() => {
        pendingFrames.current.delete(second);
        setRows((current) => ({ ...current, sliding: true }));
      });
      pendingFrames.current.add(second);
    });
    pendingFrames.current.add(first);
  }, [line]);

  return (
    <div
      className="hud-agent-line-clip"
      style={{ '--hud-agent-line-duration': HUD_AGENT_LINE_SLIDE_DURATION } as CSSProperties}
    >
      <div className={`hud-agent-line-stack${rows.sliding ? ' hud-agent-line-slide' : ''}`}>
        <div className="hud-agent-line-row">{rows.previous}</div>
        <div className="hud-agent-line-row">{rows.shown}</div>
      </div>
    </div>
  );
}
