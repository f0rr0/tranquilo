import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { Lexend, Urbanist } from "next/font/google";
import "./docs.css";

export const metadata: Metadata = {
  title: "Tranquilo Docs",
  description: "CLI and local MCP server for Pronto House Help booking flows.",
};

const lexend = Lexend({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-lexend",
});

const urbanist = Urbanist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-urbanist",
});

export default function DocsRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${lexend.variable} ${urbanist.variable}`}>
        <RootProvider
          theme={{
            defaultTheme: "system",
            enableSystem: true,
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
