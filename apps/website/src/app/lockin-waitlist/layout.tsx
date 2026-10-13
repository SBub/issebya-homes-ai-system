import type { ReactNode } from "react";

// Outside the `(main)` route group, like `/checkin`, so the root layout renders
// this page with no Header, Footer or navigation. The only outbound link is
// the privacy policy, inside the consent label.
export default function LockinWaitlistLayout({ children }: { children: ReactNode }) {
  return <main className="flex flex-1 flex-col">{children}</main>;
}
