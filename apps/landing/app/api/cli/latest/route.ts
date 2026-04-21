import release from "../../../../generated/release.json";

export const dynamic = "force-static";

export function GET() {
  return Response.json(release);
}
