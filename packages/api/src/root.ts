import { authRouter } from "./router/auth";
import { craftsRouter } from "./router/crafts";
import { itemsRouter } from "./router/items";
import { postRouter } from "./router/post";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  post: postRouter,
  items: itemsRouter,
  crafts: craftsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
