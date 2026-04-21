import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tranquilo",
  description: "CLI and local MCP server for Pronto House Help booking flows.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
