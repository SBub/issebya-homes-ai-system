import { Suspense } from "react";
import Link from "next/link";
import Copyright from "@/app/ui/Copyright";
import { InstagramLink } from "@/app/ui/InstagramLink";

export default function Footer() {
  return (
    <footer className="w-full px-6 py-2 text-sm text-gray-600 flex flex-col items-center mt-12">
      <InstagramLink />
      <div className="flex gap-3">
        <Link href="/terms-and-conditions" className="underline hover:text-gray-800">
          Terms & Conditions
        </Link>
        <Link href="/privacy-policy" className="underline hover:text-gray-800">
          Privacy Policy
        </Link>
      </div>
      <Copyright />
    </footer>
  );
}
