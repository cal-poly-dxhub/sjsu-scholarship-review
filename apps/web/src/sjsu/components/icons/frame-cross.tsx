// pixel crosshair (＋) — sits where a frame line crosses a divider. ported
// verbatim from the marketing repo (astro → react). fill uses the border token.
export function FrameCross({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`pointer-events-none absolute z-[1] text-border ${className ?? ""}`}
    >
      <path
        d="M0 10h2v2h-2ZM2 10h2v2h-2ZM4 10h2v2h-2ZM6 8h2v2h-2ZM6 10h2v2h-2ZM6 12h2v2h-2ZM8 6h2v2h-2ZM8 8h2v2h-2ZM8 10h2v2h-2ZM8 12h2v2h-2ZM8 14h2v2h-2ZM10 0h2v2h-2ZM10 2h2v2h-2ZM10 4h2v2h-2ZM10 6h2v2h-2ZM10 8h2v2h-2ZM10 10h2v2h-2ZM10 12h2v2h-2ZM10 14h2v2h-2ZM10 16h2v2h-2ZM10 18h2v2h-2ZM10 20h2v2h-2ZM12 6h2v2h-2ZM12 8h2v2h-2ZM12 10h2v2h-2ZM12 12h2v2h-2ZM12 14h2v2h-2ZM14 8h2v2h-2ZM14 10h2v2h-2ZM14 12h2v2h-2ZM16 10h2v2h-2ZM18 10h2v2h-2ZM20 10h2v2h-2Z"
        fill="currentColor"
      />
    </svg>
  );
}
