export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-[#f0eeea] font-sans">{children}</div>
  );
}
