import { z } from "zod";

// Indian mobile numbers, normalised to +91XXXXXXXXXX.
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .transform((v) => (v.startsWith("+91") ? v.slice(3) : v.startsWith("91") && v.length === 12 ? v.slice(2) : v.replace(/^0/, "")))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a valid 10-digit Indian mobile number")
  .transform((v) => `+91${v}`);

export const quoteOptionsSchema = z.object({
  hands: z.string().max(40).optional(),
  side: z.string().max(40).optional(),
  coverage: z.string().max(40).optional(),
  addons: z.array(z.string().max(40)).max(10).optional(),
  people: z.coerce.number().int().min(1).max(20).optional(),
});

export const quoteRequestSchema = z.object({
  designSlug: z.string().min(1).max(80),
  options: quoteOptionsSchema.default({}),
  couponCode: z.string().trim().toUpperCase().max(30).optional().or(z.literal("").transform(() => undefined)),
});

export const slotRequestSchema = z.object({
  designSlug: z.string().min(1).max(80),
  options: quoteOptionsSchema.default({}),
  localityId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const bookingRequestSchema = z.object({
  designSlug: z.string().min(1).max(80),
  options: quoteOptionsSchema.default({}),
  couponCode: z.string().trim().toUpperCase().max(30).optional().or(z.literal("").transform(() => undefined)),
  specialRequirements: z.string().trim().max(500).default(""),
  address: z.object({
    /** A saved address of the signed-in customer (takes precedence over the fields below). */
    id: z.string().uuid().optional(),
    line: z.string().trim().min(8, "Enter the full address — house/flat number and street").max(240),
    localityId: z.coerce.number().int().positive("Choose your locality"),
    city: z.literal("Hyderabad"),
    landmark: z.string().trim().max(120).default(""),
    instructions: z.string().trim().max(300).default(""),
    // A new address picked on Google Maps:
    house: z.string().trim().max(80).optional(),
    building: z.string().trim().max(120).optional(),
    formatted: z.string().trim().max(300).optional(),
    placeId: z.string().trim().max(300).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    label: z.string().trim().max(30).optional(),
    /** Save this new address to the customer's address book. */
    save: z.boolean().optional(),
  }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startMinute: z.coerce.number().int().min(0).max(1440),
  acceptPolicy: z.literal(true, { error: "Please accept the cancellation and refund policy" }),
  website: z.string().max(0).optional(), // honeypot — must stay empty
});

export type BookingRequest = z.infer<typeof bookingRequestSchema>;

export const verifyPaymentSchema = z.object({
  bookingToken: z.string().min(20).max(100),
  razorpay_order_id: z.string().min(1).max(64),
  razorpay_payment_id: z.string().min(1).max(64),
  razorpay_signature: z.string().min(1).max(256),
});
