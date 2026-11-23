import { LegalPage } from "@/components/site/LegalPage";

export const metadata = { title: "Terms and conditions" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms and conditions">
      <h2>About the service</h2>
      <p>VAISHORA is an online platform that helps customers in Hyderabad discover mehndi designs and book independent mehndi artists who travel to the customer’s location.</p>
      <h2>Bookings</h2>
      <ul>
        <li>A booking is reserved when the advance payment is confirmed by our payment partner. Unpaid bookings are released automatically.</li>
        <li>An artist is requested for each paid booking. The booking is confirmed once the artist accepts. If no artist can be confirmed, the advance is refunded in full.</li>
        <li>Prices shown at checkout are final for the options selected. Changes requested on the day (for example, more coverage or extra people) are charged at the published rates.</li>
        <li>The balance amount is payable to the artist after the session.</li>
      </ul>
      <h2>Designs and results</h2>
      <p>3D previews are illustrations. Hand-applied mehndi will vary from the preview. Stain colour depends on skin type, henna quality and aftercare.</p>
      <h2>Health and safety</h2>
      <p>Tell us about any allergies or skin conditions in “Special requirements”. Artists may decline to apply mehndi where they believe it is unsafe.</p>
      <h2>Cancellations and refunds</h2>
      <p>See the Cancellation and refund policy, which forms part of these terms.</p>
      <h2>Conduct</h2>
      <p>Customers and artists must treat each other respectfully. We may cancel bookings or suspend accounts in case of abuse, fraud or safety concerns.</p>
      <h2>Contact</h2>
      <p>For questions about these terms, use the contact page.</p>
    </LegalPage>
  );
}
