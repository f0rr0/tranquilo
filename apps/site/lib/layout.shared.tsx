import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

function BrandTitle() {
  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        fontWeight: 800,
        gap: 10,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          background: "var(--pronto-green)",
          border:
            "4px solid color-mix(in oklab, var(--pronto-green) 24%, white)",
          borderRadius: 999,
          boxShadow:
            "0 0 0 1px color-mix(in oklab, var(--pronto-green) 22%, transparent)",
          display: "inline-block",
          height: 18,
          width: 18,
        }}
      />
      Tranquilo
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: "https://github.com/f0rr0/tranquilo",
    nav: {
      title: <BrandTitle />,
    },
    links: [
      {
        text: "Home",
        url: "/",
      },
      {
        text: "Install",
        url: "/install.sh",
      },
      {
        text: "GitHub",
        url: "https://github.com/f0rr0/tranquilo",
      },
    ],
  };
}
