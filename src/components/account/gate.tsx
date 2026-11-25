import { redirect } from "next/navigation";
import { currentCustomer, type Customer } from "@/server/customer-auth";
import { currentArtist } from "@/server/artist-auth";

/** For account sub-pages: the signed-in customer, or a redirect to the sign-in page. */
export async function requireCustomerPage(): Promise<Customer> {
  if (await currentArtist()) redirect("/artist-portal");
  const me = await currentCustomer();
  if (!me) redirect("/account");
  return me;
}
