import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";
import { icons } from "lucide-react";
import { createElement } from "react";

function normalizeIconName(icon: string): keyof typeof icons | null {
  const normalized = icon
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  return normalized in icons ? (normalized as keyof typeof icons) : null;
}

export const source = loader({
  baseUrl: "/docs",
  icon(icon) {
    if (!icon) {
      return;
    }
    const normalized = normalizeIconName(icon);
    if (!normalized) {
      return;
    }
    return createElement(icons[normalized]);
  },
  source: docs.toFumadocsSource(),
});
