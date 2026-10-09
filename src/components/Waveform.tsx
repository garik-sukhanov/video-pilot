import { useEffect, useRef } from 'react';

interface Props {
  peaks: number[];
  inSec: number;
  outSec: number;
  sourceDurationSec: number;
  width: number;
  height: number;
  color?: string;
}

export function Waveform({
  peaks,
  inSec,
  outSec,
  sourceDurationSec,
  width,
  height,
  color = 'rgba(255,255,255,0.55)',
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || peaks.length === 0 || sourceDurationSec <= 0 || width <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const startIdx = Math.max(0, Math.floor((inSec / sourceDurationSec) * peaks.length));
    const endIdx = Math.min(peaks.length, Math.ceil((outSec / sourceDurationSec) * peaks.length));
    const slice = endIdx > startIdx ? peaks.slice(startIdx, endIdx) : [];
    if (slice.length === 0) return;

    const barCount = Math.max(1, Math.floor(width));
    const samplesPerBar = slice.length / barCount;
    const midY = height / 2;
    const usableH = height - 4;

    ctx.fillStyle = color;
    for (let x = 0; x < barCount; x++) {
      const s = Math.floor(x * samplesPerBar);
      const e = Math.max(s + 1, Math.floor((x + 1) * samplesPerBar));
      let max = 0;
      for (let i = s; i < e && i < slice.length; i++) {
        if (slice[i] > max) max = slice[i];
      }
      const barH = Math.max(1, max * usableH);
      ctx.fillRect(x, midY - barH / 2, 1, barH);
    }
  }, [peaks, inSec, outSec, sourceDurationSec, width, height, color]);

  return (
    <canvas
      ref={ref}
      className="absolute inset-0 pointer-events-none"
      style={{ width, height }}
    />
  );
}
