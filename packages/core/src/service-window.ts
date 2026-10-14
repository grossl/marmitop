// WhatsApp 24-hour service window (ADR-014, FR-117). Free text is allowed only within
// 24 hours after the customer's last inbound message.

import { AppError } from "./errors";

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TemplateRef {
  readonly name: string;
  readonly language: string;
}

export type ServiceWindowDecision =
  | { readonly mode: "text" }
  | { readonly mode: "template"; readonly templateName: string; readonly templateLanguage: string }
  | { readonly mode: "blocked"; readonly errorCode: "outside_service_window" };

/** "Older than 24 hours" is outside, so exactly 24 hours is still inside. */
export function isWithinServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() <= SERVICE_WINDOW_MS;
}

export function decideServiceWindow(input: {
  readonly lastInboundAt: Date | null;
  readonly now: Date;
  readonly template: TemplateRef | null;
}): ServiceWindowDecision {
  if (isWithinServiceWindow(input.lastInboundAt, input.now)) return { mode: "text" };
  if (input.template) {
    return { mode: "template", templateName: input.template.name, templateLanguage: input.template.language };
  }
  return { mode: "blocked", errorCode: "outside_service_window" };
}

/** Manual reply guard: throws `422 outside_service_window` before anything is stored. */
export function assertFreeTextAllowed(lastInboundAt: Date | null, now: Date): void {
  if (!isWithinServiceWindow(lastInboundAt, now)) {
    throw new AppError(
      "outside_service_window",
      "The customer last wrote more than 24 hours ago. Free text is not allowed.",
    );
  }
}
