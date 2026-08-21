import { useCallback, useEffect, useRef } from "react";

// delicate ascii wave field for the side gutters. ported from the marketing
// repo. only change: measures its parent element (ResizeObserver) instead of
// window, so it can live inside the outlet gutters instead of the viewport edge.
interface AsciiDotsProps {
  textColor?: string; // "r, g, b"
  rows?: number; // vertical resolution; cols derived from width
  animationSpeed?: number;
  className?: string;
}

interface Wave {
  x: number;
  y: number;
  frequency: number;
  amplitude: number;
  phase: number;
  speed: number;
}

const CHARS =
  "⠁⠂⠄⠈⠐⠠⡀⢀⠃⠅⠘⠨⠊⠋⠌⠍⠎⠏⠑⠒⠓⠔⠕⠖⠗⠙⠚⠛⠜⠝⠞⠟⠡⠢⠣⠤⠥⠦⠧⠩⠪⠫⠬⠭⠮⠯⠱⠲⠳⠴⠵⠶⠷⠹⠺⠻⠼⠽⠾⠿⡁⡂⡃⡄⡅⡆⡇⣀⣁⣂⣃⣄⣅⣆⣇⣤⣥⣦⣧⣼⣽⣾⣿";

export function AsciiDots({
  textColor = "113, 113, 122",
  rows = 56,
  animationSpeed = 0.75,
  className,
}: AsciiDotsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wavesRef = useRef<Wave[]>([]);
  const timeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const dims = useRef({ width: 0, height: 0 });

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    // measure the gutter box this canvas lives in, not the viewport
    const rect = parent.getBoundingClientRect();
    const width = Math.max(0, rect.width);
    const height = Math.max(0, rect.height);
    dims.current = { width, height };
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const { width, height } = dims.current;
    if (!canvas || !ctx || width === 0 || height === 0) {
      rafRef.current = requestAnimationFrame(animate);
      return;
    }

    timeRef.current += animationSpeed * 0.016;
    ctx.clearRect(0, 0, width, height);

    const cell = height / rows;
    const cols = Math.ceil(width / cell) + 1;
    const font = cell * 0.8;
    ctx.font = `${font}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let total = 0;
        for (const w of wavesRef.current) {
          const dx = x - w.x;
          const dy = y - w.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const falloff = 1 / (1 + dist * 0.1);
          total +=
            Math.sin(dist * w.frequency - timeRef.current * w.speed + w.phase) *
            w.amplitude *
            falloff;
        }
        if (Math.abs(total) <= 0.2) continue;
        const norm = (total + 2) / 4;
        const ci = Math.min(
          CHARS.length - 1,
          Math.max(0, Math.floor(norm * (CHARS.length - 1))),
        );
        const opacity = Math.min(0.7, Math.max(0.25, 0.25 + norm * 0.45));
        ctx.fillStyle = `rgba(${textColor}, ${opacity})`;
        ctx.fillText(CHARS[ci] ?? "", x * cell + cell / 2, y * cell + cell / 2);
      }
    }

    rafRef.current = requestAnimationFrame(animate);
  }, [textColor, rows, animationSpeed]);

  useEffect(() => {
    resize();
    // place waves inside the actually-visible grid (cols derived from width)
    const { width, height } = dims.current;
    const cell = height / rows || 1;
    const cols = Math.max(1, Math.ceil(width / cell));
    // seed positions off the index-free constants so it renders without Math.random per cell
    wavesRef.current = Array.from({ length: 4 }, (_unused, i) => ({
      x: cols * (0.15 + ((i * 0.21) % 0.7)),
      y: rows * (0.15 + ((i * 0.37) % 0.7)),
      frequency: 0.2 + ((i * 0.11) % 0.3),
      amplitude: 0.5 + ((i * 0.17) % 0.5),
      phase: (i * Math.PI) / 2,
      speed: 0.5 + ((i * 0.13) % 0.5),
    }));

    const parent = canvasRef.current?.parentElement;
    const observer = new ResizeObserver(() => resize());
    if (parent) observer.observe(parent);
    animate();
    return () => {
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [rows, resize, animate]);

  return <canvas ref={canvasRef} className={className} />;
}

export default AsciiDots;
