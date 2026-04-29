import { TRPCError } from "@trpc/server";

import type { Session } from "@acme/auth";
import { resolveViewer } from "@acme/api/authz";

export async function requireMemberViewer(session: Session | null) {
  const viewer = await resolveViewer(session);
  if (!viewer.isAuthenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!viewer.canAccessMember) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return viewer;
}
