import type { Request, RequestHandler } from "express";

type MinimalRequest = Pick<Request, "method" | "path">;

const LEGACY_HEARTBEAT_READ_ROUTE =
  /^\/heartbeat-runs\/[^/]+(?:\/(?:events|issues|log|workspace-operations))?\/?$/;
const LEGACY_HEARTBEAT_WRITE_ROUTE =
  /^\/heartbeat-runs\/[^/]+\/(?:cancel|watchdog-decisions)\/?$/;
const LEGACY_RUN_READ_ROUTE =
  /^\/runs\/[^/]+(?:\/logs)?\/?$/;
const LEGACY_AGENT_RUN_ROUTE =
  /^\/agents\/[^/]+\/runs\/[^/]+\/?$/;
const LEGACY_ISSUE_RUN_ROUTE =
  /^\/issues\/[^/]+\/(?:active-run|live-runs|runs)\/?$/;
const LEGACY_ISSUE_PATCH_ROUTE = /^\/issues\/[^/]+\/?$/;

export function isLegacyApiCompatibilityRequest(req: MinimalRequest): boolean {
  const method = req.method.toUpperCase();
  const path = req.path;

  if (method === "GET") {
    return (
      LEGACY_HEARTBEAT_READ_ROUTE.test(path) ||
      LEGACY_RUN_READ_ROUTE.test(path) ||
      LEGACY_AGENT_RUN_ROUTE.test(path) ||
      LEGACY_ISSUE_RUN_ROUTE.test(path)
    );
  }

  if (method === "POST") {
    return LEGACY_HEARTBEAT_WRITE_ROUTE.test(path);
  }

  if (method === "PATCH") {
    return LEGACY_ISSUE_PATCH_ROUTE.test(path);
  }

  return false;
}

export function createLegacyApiCompatibilityMiddleware(compatRouter: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (!isLegacyApiCompatibilityRequest(req)) {
      next();
      return;
    }

    compatRouter(req, res, next);
  };
}
