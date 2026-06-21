"use client";

import { useEffect, useState, type ReactNode } from "react";

export type CritterMood = "idle" | "perky" | "celebrate" | "smile" | "working" | "attentive" | "grumpy";

interface CritterProps {
  mood?: CritterMood;
  size?: number;
  animate?: boolean;
}

const IDLE_FRAMES: string[][] = [
  ["  ∧   ∧ ", " (◕ ◡ ◕)", "  ╰───╯ "],
  ["  ∧   ∧ ", " (◕ ◡ ·)", "  ╰───╯ "],
  ["  ∧   ∧ ", " (─ ◡ ─)", "  ╰───╯ "],
];

const PERKY_FRAME: string[] = [" ✦∧   ∧✦", " (◕ ▿ ◕)", "  ╰───╯ "];
const CELEBRATE_FRAME: string[] = [" ✦∧   ∧✦", " (^ ⌣ ^)", "  ╰───╯ "];
const SMILE_FRAME: string[] = ["  ∧   ∧ ", " (◕ ‿ ◕)", "  ╰───╯ "];
const ATTENTIVE_FRAME: string[] = ["  ∧   ∧ ", " (◉ ‿ ◉)", "  ╰───╯ "];
const GRUMPY_FRAME: string[] = ["  ∧   ∧ ", " (ò ⌢ ó)", "  ╰───╯ "];

const WORKING_FRAMES: string[][] = [
  ["  ∧   ∧ ", " (◐ · ◐)", "  ╰───╯ "],
  ["  ∧   ∧ ", " (◓ · ◓)", "  ╰───╯ "],
  ["  ∧   ∧ ", " (◑ · ◑)", "  ╰───╯ "],
  ["  ∧   ∧ ", " (◒ · ◒)", "  ╰───╯ "],
];

const IDLE_DURATIONS = [2600, 500, 120];
const WORKING_DURATION = 180;

function colorizeEyes(line: string): ReactNode {
  const eyeChars = new Set(["◕", "─", "·", "◡", "▿", "‿", "◉", "⌣", "⌢", "ò", "ó", "^", "◐", "◑", "◒", "◓", "✦"]);
  return Array.from(line).map((ch, i) =>
    eyeChars.has(ch) ? (
      <span key={i} style={{ color: "var(--amber)" }}>{ch}</span>
    ) : (
      <span key={i}>{ch}</span>
    )
  );
}

export default function Critter({ mood = "idle", size, animate = true }: CritterProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  const isAnimatedIdle = mood === "idle" && animate;
  const isAnimatedWorking = mood === "working" && animate;

  useEffect(() => {
    if (!isAnimatedIdle && !isAnimatedWorking) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let timer: ReturnType<typeof setTimeout>;
    let current = 0;

    const tick = () => {
      const frames = isAnimatedWorking ? WORKING_FRAMES : IDLE_FRAMES;
      current = (current + 1) % frames.length;
      setFrameIndex(current);
      const delay = isAnimatedWorking ? WORKING_DURATION : IDLE_DURATIONS[current];
      timer = setTimeout(tick, delay);
    };

    const initial = isAnimatedWorking ? WORKING_DURATION : IDLE_DURATIONS[0];
    timer = setTimeout(tick, initial);
    return () => clearTimeout(timer);
  }, [isAnimatedIdle, isAnimatedWorking]);

  let lines: string[];
  switch (mood) {
    case "perky":     lines = PERKY_FRAME; break;
    case "celebrate": lines = CELEBRATE_FRAME; break;
    case "smile":     lines = SMILE_FRAME; break;
    case "attentive": lines = ATTENTIVE_FRAME; break;
    case "grumpy":    lines = GRUMPY_FRAME; break;
    case "working":   lines = animate ? WORKING_FRAMES[frameIndex] : WORKING_FRAMES[0]; break;
    case "idle":
    default:          lines = isAnimatedIdle ? IDLE_FRAMES[frameIndex] : IDLE_FRAMES[0]; break;
  }

  const minHeight = Math.max(IDLE_FRAMES[0].length, lines.length);

  return (
    <pre
      aria-hidden="true"
      className="font-mono whitespace-pre leading-tight text-text select-none"
      style={{ fontSize: size ? `${size}rem` : undefined, minHeight: `${minHeight * 1.1}em`, margin: 0 }}
    >
      {lines.map((line, i) => (
        <div key={i}>{colorizeEyes(line)}</div>
      ))}
    </pre>
  );
}
