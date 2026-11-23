const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const INR2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format paise as rupees. Whole rupees drop the decimals. */
export function formatPaise(paise: number): string {
  return paise % 100 === 0 ? INR.format(paise / 100) : INR2.format(paise / 100);
}

export const rupeesToPaise = (r: number) => Math.round(r * 100);
