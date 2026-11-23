import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/components/error-component.tsx";
import { routeTree } from "./routeTree.gen";

/** Usmerjevalnik programa; routeTree.gen.ts ustvari vticnik TanStack ob gradnji ali zagonu razvojnega streznika. */
export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    scrollRestoration: true,
  });
}
