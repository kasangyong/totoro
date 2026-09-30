import type { Metadata } from "next";
import { Black_Han_Sans, IBM_Plex_Sans_KR, Oswald } from "next/font/google";
import "./globals.css";

const oswald = Oswald({ variable: "--font-oswald", subsets: ["latin"], weight: ["500", "600", "700"] });
const blackHanSans = Black_Han_Sans({ variable: "--font-bhs", weight: "400", preload: false });
const plex = IBM_Plex_Sans_KR({ variable: "--font-plex", weight: ["400", "500", "700"], preload: false });

export const metadata: Metadata = {
  title: "배팅 할래 말래",
  description: "우리끼리 가상 포인트로 즐기는 게임장",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${oswald.variable} ${blackHanSans.variable} ${plex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
