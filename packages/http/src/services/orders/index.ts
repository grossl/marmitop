// orders domain services (P4b): board, KPIs, detail, status moves, manual order.
// See packages/http/README.md.

export * from "./change-status";
export * from "./create-order";
export * from "./customer-lookup";
export * from "./list-orders";
export * from "./order-form";
export * from "./order-settings";
export * from "./payment";
export type {
  AddressParts,
  BoardOrder,
  OrderDetail,
  OrderItemView,
  OrderSourceCode,
  PaymentMethodCode,
  StatusHistoryView,
} from "./shared";
export { formatAddressLine } from "./shared";
