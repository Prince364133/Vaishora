import { FindBookingForm } from "./FindBookingForm";

export const metadata = { title: "Find my booking", robots: { index: false } };

export default function FindBookingPage() {
  return (
    <div className="container-v max-w-md py-8 md:py-16">
      <h1 className="text-[2.5rem]">Find my booking</h1>
      <p className="mt-2 text-muted">Enter your booking ID and the mobile number used to book.</p>
      <FindBookingForm />
    </div>
  );
}
