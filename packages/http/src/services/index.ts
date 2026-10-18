// One file per domain. Each exports services built with `defineService`.
// Later P4 agents add: orders, customers, menu, stock, reports, settings,
// conversations (09.plan.md T4.4–T4.12). See packages/http/README.md.

export * from "./admin";
export * from "./ai";
export * from "./billing";
export * from "./catalog";
export * from "./finance";
export * from "./invoices";
export * from "./messaging";
export * from "./orders";
export * from "./public-api";
export * from "./restaurant-profile";
export * from "./webhooks";
export * from "./whatsapp";
