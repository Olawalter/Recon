"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/history", label: "History" },
  { href: "/create", label: "Create Recon" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Sections" className="flex items-center gap-1">
      {LINKS.map((l) => {
        const on = path === l.href || (l.href === "/dashboard" && path.startsWith("/recon/"));
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
                className={`px-2.5 py-1.5 text-sm ${on ? "text-amber" : "text-muted hover:text-warm"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
