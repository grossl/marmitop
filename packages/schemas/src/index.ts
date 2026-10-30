// @mt/schemas: Zod request schemas shared by apps/api, apps/worker, and apps/dashboard (04.architecture.md).
// HTTP API bodies use snake_case (06.api-spec.md). Server Action inputs use camelCase (06, Appendix A).

export const packageName = "@mt/schemas";

export * from "./ai";
export * from "./common";
export * from "./customers";
export * from "./finance";
export * from "./integrations";
export * from "./invoices";
export * from "./menu";
export * from "./messages";
export * from "./orders";
export * from "./printing";
export * from "./queues";
export * from "./reports";
export * from "./settings";
export * from "./stock";
