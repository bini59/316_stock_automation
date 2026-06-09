import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavBar } from "./nav";

// Sohne 대체 — Inter weight 300/400, ss01·tnum 은 globals.css 에서 적용.
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-inter",
  display: "swap",
});

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
    <html lang="ko" className={inter.variable}>
      <body>
        <NavBar />
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
