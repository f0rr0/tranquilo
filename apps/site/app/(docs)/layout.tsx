import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import "./docs.css";

export const metadata: Metadata = {
  title: "Tranquilo Docs",
  description: "CLI and local MCP server for Pronto House Help booking flows.",
};

export default function DocsRootLayout({
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
