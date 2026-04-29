import { createFileRoute } from "@tanstack/react-router";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

import { auth } from "~/auth/server";
import { requireMemberViewer } from "~/lib/authz.server";
import { createStaticApiResponse } from "~/lib/static-api.server";

async function handler(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  try {
    await requireMemberViewer(session);
  } catch (error) {
    if (error instanceof TRPCError) {
      return new Response(error.message, {
        status: getHTTPStatusCodeFromError(error),
      });
    }
    return new Response("Internal Server Error", { status: 500 });
  }

  return createStaticApiResponse(request, "crafts-all");
}

export const Route = createFileRoute("/api/static/crafts-all" as never)({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
    },
  },
});
