import type { UseCaseId } from "./useCases";
import { USE_CASES } from "./useCases";

export type Page = "landing" | "demo";

export interface RouteState {
  page: Page;
  useCase: UseCaseId;
}

export function routeFromHash(): RouteState {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (!hash || hash === "landing") {
    return { page: "landing", useCase: "dao" };
  }

  const parts = hash.split("/").filter(Boolean);
  if (parts[0] === "demo" || parts[0] === "app") {
    const maybeCase = parts[1];
    const useCase = USE_CASES.some((item) => item.id === maybeCase)
      ? (maybeCase as UseCaseId)
      : "dao";
    return { page: "demo", useCase };
  }

  return { page: "landing", useCase: "dao" };
}

export function hashFor(page: Page, useCase: UseCaseId = "dao"): string {
  if (page === "landing") return "#/landing";
  return `#/demo/${useCase}`;
}
