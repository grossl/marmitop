// One file per domain. Each exports services built with `defineService`.
// Later P4 agents add: orders, customers, menu, stock, reports, settings,
// conversations (09.plan.md T4.4–T4.12). See packages/http/README.md.

export * from "./restaurant-profile";
