import { Suspense } from "react";
import Link from "next/link";
import Copyright from "@/app/ui/Copyright";
import { InstagramLink } from "@/app/ui/InstagramLink";

export default function Footer() {
  return (
    <footer className="bg-white w-full border-t border-gray-300 px-6 py-3 text-sm text-gray-600 flex flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1.5">
      <InstagramLink />
      <Link
        href="/terms-and-conditions"
        className="text-secondary hover:underline underline-offset-4"
      >
        Terms & Conditions
      </Link>
      <Link href="/privacy-policy" className="text-secondary hover:underline underline-offset-4">
        Privacy Policy
      </Link>
      <Copyright />
    </footer>
  );
}
