import type { Metadata } from "next";
import {
  Inter,
  JetBrains_Mono,
  Lexend,
  Mrs_Saint_Delafield,
} from "next/font/google";
import "./landing.css";

export const metadata: Metadata = {
  title: "Tranquilo | Pronto House Help from your terminal",
  description:
    "Find, watch, and book Pronto House Help slots from your terminal or local AI agent.",
};

const jetbrainsMono = JetBrains_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-mono",
});

const inter = Inter({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500"],
});

const script = Mrs_Saint_Delafield({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-script",
  weight: "400",
});

const pronto = Lexend({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-pronto",
  weight: "800",
});

export default function LandingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${jetbrainsMono.variable} ${inter.variable} ${script.variable} ${pronto.variable} tranquilo-landing min-h-screen w-full overflow-x-hidden bg-[#f2ead8] font-landing-mono font-normal text-[#2c1a0e] text-[11px] leading-[1.5] antialiased selection:bg-[#2c1a0e] selection:text-[#f2ead8]`}
      >
        {children}
      </body>
    </html>
  );
}
