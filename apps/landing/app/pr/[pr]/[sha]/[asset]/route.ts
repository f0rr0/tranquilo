import { routeResponse } from "../../../../lib/install-response";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ asset: string; pr: string; sha: string }> }
) {
  const { asset, pr, sha } = await context.params;
  return routeResponse(request, `pr/${pr}/${sha}/${asset}`);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ asset: string; pr: string; sha: string }> }
) {
  const { asset, pr, sha } = await context.params;
  return routeResponse(request, `pr/${pr}/${sha}/${asset}`);
}
