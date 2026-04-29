import type { TRPCRouterRecord } from "@trpc/server";

import { adminProcedure, memberProcedure, publicProcedure } from "../trpc";

export const authRouter = {
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),
  getViewer: publicProcedure.query(({ ctx }) => {
    return ctx.viewer;
  }),
  requireMember: memberProcedure.query(() => {
    return { ok: true } as const;
  }),
  requireAdmin: adminProcedure.query(() => {
    return { ok: true } as const;
  }),
} satisfies TRPCRouterRecord;
