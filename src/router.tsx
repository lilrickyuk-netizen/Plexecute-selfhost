import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // A failed load must never read as "nothing here yet": tell the member once and let them retry.
    defaultOptions: { queries: { retry: 1 } },
    queryCache: new QueryCache({
      onError: () => {
        if (typeof window === "undefined") return;
        toast.error(
          "Some of your information couldn't load. Check your connection and refresh to try again.",
          { id: "load-failed", duration: 15000 },
        );
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
