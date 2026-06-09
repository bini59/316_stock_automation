"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/backtest", label: "백테스트" },
  { href: "/live", label: "실거래" },
];

export function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="app-nav">
      <span className="brand">Regime Trader</span>
      <div className="links">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={pathname.startsWith(l.href) ? "active" : ""}
          >
            {l.label}
          </Link>
        ))}
      </div>
      <div className="spacer" />
      <span className="dim" style={{ fontSize: 12 }}>
        UI는 읽고, 엔진이 결정한다
      </span>
    </nav>
  );
}
