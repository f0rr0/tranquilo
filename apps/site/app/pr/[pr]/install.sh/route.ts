import { routeResponse } from "../../../lib/install-response";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ pr: string }> }
) {
  const { pr } = await context.params;
  return routeResponse(request, `pr/${pr}/install.sh`);
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ pr: string }> }
) {
  const { pr } = await context.params;
  return routeResponse(request, `pr/${pr}/install.sh`);
}
