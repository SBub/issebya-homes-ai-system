import { type ReactNode, Suspense } from "react";
import Footer from "@/app/ui/Footer";
import Header from "@/app/ui/Header";

export default function MainLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <Header />
      </Suspense>
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
