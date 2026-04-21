import { routeResponse } from "../../../_lib/install-response";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ asset: string; version: string }> }
) {
  const { asset, version } = await context.params;
  return routeResponse(request, `releases/${version}/${asset}`);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ asset: string; version: string }> }
) {
  const { asset, version } = await context.params;
  return routeResponse(request, `releases/${version}/${asset}`);
}
