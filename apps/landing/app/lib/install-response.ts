import { handleInstallRoute } from "@tranquilo/product/install-routes";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function routeResponse(
  request: Request,
  path: string
): Promise<Response> {
  const response = await handleInstallRoute(
    { method: request.method, origin: new URL(request.url).origin, path },
    {
      ...process.env,
      fetch,
    }
  );
  const body =
    response.body instanceof Uint8Array
      ? arrayBuffer(response.body)
      : response.body;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: response.headers,
    status: response.status,
  });
}
