import { skillMarkdown } from "@/generated/skill";

export const revalidate = false;

export function GET() {
  return new Response(skillMarkdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
