import { Suspense } from "react";
import Copyright from "@/app/ui/Copyright";
import { InstagramLink } from "@/app/ui/InstagramLink";

export default function Footer() {
  return (
    <footer className="w-full px-6 py-2 text-sm text-gray-600 flex flex-col items-center mt-12">
      <InstagramLink />
      <Suspense fallback={<div>Loading cop...</div>}>
        <Copyright />
      </Suspense>
    </footer>
  );
}
