import { TRPCError } from "@trpc/server";

import type { Session } from "@acme/auth";
import { resolveSessionForRequest, resolveViewer } from "@acme/api/authz";

export async function requireMemberViewer(
  session: Session | null,
  headers: Headers,
) {
  const resolvedSession = await resolveSessionForRequest(headers, session);
  const viewer = await resolveViewer(resolvedSession, session);
  if (!viewer.isAuthenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!viewer.canAccessMember) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return viewer;
}
