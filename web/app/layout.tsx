import type { Metadata } from "next";
import "./globals.css";
import { NavBar } from "./nav";

export const metadata: Metadata = {
  title: "Regime Trader — 관측·제어 대시보드",
  description:
    "백테스트 확인·보정 + 실거래 모니터링. UI는 읽고, 엔진이 결정한다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <NavBar />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
