import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

function GitHubIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .3C5.37.3 0 5.67 0 12.3c0 5.3 3.44 9.8 8.2 11.38.6.12.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.23 1.84 1.23 1.07 1.84 2.8 1.31 3.49 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.21.7.82.58A12.02 12.02 0 0 0 24 12.3C24 5.67 18.63.3 12 .3Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.2 2.75h3.07l-6.7 7.66 7.88 10.84h-6.17l-4.83-6.57-5.53 6.57H2.84l7.17-8.51L2.45 2.75h6.33l4.37 5.99 5.05-5.99Zm-1.08 16.59h1.7L7.85 4.56H6.02z" />
    </svg>
  );
}

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
    nav: {
      title: <BrandTitle />,
    },
    links: [
      {
        external: true,
        icon: <GitHubIcon />,
        label: "GitHub",
        on: "menu",
        text: "GitHub",
        type: "icon",
        url: "https://github.com/f0rr0/tranquilo",
      },
      {
        external: true,
        icon: <XIcon />,
        label: "X",
        on: "menu",
        text: "X",
        type: "icon",
        url: "https://x.com/f0rr0",
      },
    ],
  };
}
