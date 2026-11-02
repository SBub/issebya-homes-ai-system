export default function BookingConfirmationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-shop-card font-sans">{children}</div>
  );
}
