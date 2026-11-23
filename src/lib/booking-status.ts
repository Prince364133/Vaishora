// Booking state machine. Every status change in the system goes through
// `assertTransition`, and is recorded in booking_status_history.

export const BOOKING_STATUSES = [
  "pending_payment",
  "paid",
  "awaiting_artist_assignment",
  "awaiting_artist_confirmation",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
  "refund_pending",
  "refunded",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ["paid", "expired", "cancelled"],
  paid: ["awaiting_artist_confirmation", "awaiting_artist_assignment", "refund_pending", "cancelled"],
  awaiting_artist_assignment: ["awaiting_artist_confirmation", "cancelled", "refund_pending"],
  awaiting_artist_confirmation: ["confirmed", "awaiting_artist_assignment", "cancelled", "refund_pending"],
  confirmed: ["in_progress", "awaiting_artist_assignment", "cancelled", "refund_pending"],
  in_progress: ["completed"],
  completed: [],
  cancelled: ["refund_pending"],
  // A payment can complete after the hold lapsed (slow UPI/bank confirmation); the system
  // then revives the booking if the slot is still free, or sends it for manual assignment.
  expired: ["paid"],
  refund_pending: ["refunded", "cancelled"],
  refunded: [],
};

/** Statuses during which the booked artist's time is reserved. */
export const ACTIVE_HOLD_STATUSES: BookingStatus[] = [
  "pending_payment",
  "paid",
  "awaiting_artist_confirmation",
  "confirmed",
  "in_progress",
];

export function canTransition(from: BookingStatus, to: BookingStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: BookingStatus, to: BookingStatus) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export class InvalidTransitionError extends Error {
  constructor(public from: BookingStatus, public to: BookingStatus) {
    super(`A booking cannot move from "${STATUS_LABEL[from]}" to "${STATUS_LABEL[to]}".`);
  }
}

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending_payment: "Pending payment",
  paid: "Paid",
  awaiting_artist_assignment: "Awaiting artist assignment",
  awaiting_artist_confirmation: "Awaiting artist confirmation",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  expired: "Payment window expired",
  refund_pending: "Refund pending",
  refunded: "Refunded",
};

/** Customer-facing explanation of what happens next. */
export const STATUS_NEXT_STEP: Record<BookingStatus, string> = {
  pending_payment: "Complete the advance payment to reserve this slot. Unpaid slots are released automatically.",
  paid: "Payment received. We are confirming your artist.",
  awaiting_artist_assignment: "Payment received. Our team is assigning an artist and will contact you on WhatsApp.",
  awaiting_artist_confirmation: "Payment received. Your artist has been requested and will confirm shortly. We will message you once confirmed.",
  confirmed: "Your artist has confirmed. They will arrive at your address at the booked time.",
  in_progress: "Your mehndi session is in progress.",
  completed: "Session completed. We hope you love your mehndi.",
  cancelled: "This booking was cancelled.",
  expired: "The payment window closed and the slot was released. You can book again.",
  refund_pending: "Your refund has been initiated. Banks usually take 5–7 working days to credit it.",
  refunded: "Your refund has been processed.",
};
