import { routeResponse } from "../_lib/install-response";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return routeResponse(request, "install.sh");
}

export function HEAD(request: Request) {
  return routeResponse(request, "install.sh");
}
