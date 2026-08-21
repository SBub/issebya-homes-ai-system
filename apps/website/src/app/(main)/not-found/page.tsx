"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Custom404() {
  const router = useRouter();

  useEffect(() => {
    // Optional: Redirect to home after 2s
    const timeout = setTimeout(() => {
      router.push("/booking/room1");
    }, 2000);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>404 - Page Not Found</h1>
      <p>We’ll take you back home shortly...</p>
    </div>
  );
}
