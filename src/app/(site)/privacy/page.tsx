import { LegalPage } from "@/components/site/LegalPage";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <h2>What we collect</h2>
      <ul>
        <li>Booking details: your name, mobile number, optional email, service address, locality, landmark and instructions.</li>
        <li>Payment status from our payment partner (order and payment references, amount, status). We never receive or store card numbers, CVV, UPI PINs or net-banking passwords.</li>
        <li>Messages you send through the contact and artist application forms.</li>
        <li>Basic technical logs (such as IP address) used for security and abuse prevention.</li>
      </ul>
      <h2>Why we use it</h2>
      <ul>
        <li>To schedule and deliver your booking, including sharing your address and phone number with the assigned artist once they accept.</li>
        <li>To process payments and refunds, and to keep records required by law.</li>
        <li>To contact you about your booking and respond to support requests.</li>
      </ul>
      <h2>Who can see it</h2>
      <p>Only authorised VAISHORA staff and the artist assigned to your booking. Artists see your exact address and phone number only after accepting your booking. We do not sell your data.</p>
      <h2>Your booking link</h2>
      <p>Your booking page uses a private link. Anyone with the link can view the booking, so please keep it private.</p>
      <h2>Retention and your rights</h2>
      <p>We keep booking and payment records for as long as required for tax and accounting purposes. You can ask us to access, correct or delete personal data that we are not required to retain, through the contact page.</p>
    </LegalPage>
  );
}
