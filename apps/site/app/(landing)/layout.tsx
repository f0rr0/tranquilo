import type { Metadata } from "next";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "Tranquilo",
  description: "CLI and local MCP server for Pronto House Help booking flows.",
};

export default function LandingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={styles.body}>{children}</body>
    </html>
  );
}
