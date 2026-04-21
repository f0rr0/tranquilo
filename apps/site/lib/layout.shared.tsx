import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: "https://github.com/f0rr0/tranquilo",
    nav: {
      title: "Tranquilo",
    },
    links: [
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
