export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#1f5f64" />
      <path d="M9 11.5 16 22l7-10.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22.5 7.5c1.6.9 2.7 2.4 3 4.2M21.6 10c.7.4 1.2 1.1 1.3 1.9" fill="none" stroke="#84cbcc" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ name = process.env.NEXT_PUBLIC_APP_NAME ?? "Vakta" }: { name?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight text-slate-900">{name}</span>
    </span>
  );
}
