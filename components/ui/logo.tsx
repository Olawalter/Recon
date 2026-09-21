/** The RECON mark: three sources converging on one reconciled state. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="6" fill="#15181D" />
      <path d="M5 7 L19 16 M5 16 H19 M5 25 L19 16" stroke="#F2F0EA" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="5" cy="7" r="2" fill="#F2F0EA" />
      <circle cx="5" cy="16" r="2" fill="#F2F0EA" />
      <circle cx="5" cy="25" r="2" fill="#8A919B" />
      <circle cx="22.5" cy="16" r="5" fill="#F2A93B" />
      <circle cx="22.5" cy="16" r="2" fill="#15181D" />
    </svg>
  );
}
