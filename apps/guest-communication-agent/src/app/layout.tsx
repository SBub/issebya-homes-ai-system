import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "GCA Recovery Admin",
};

// Wrapping in Radix Themes' <Theme> (and importing its stylesheet above) is
// required for any @radix-ui/themes component used by src/app/admin/
// conversations/page.tsx to render correctly at all — without it, Table/
// Card/Badge/etc. render unstyled. Mirrors apps/crm/src/app/layout.tsx's own
// pattern exactly.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Theme>{children}</Theme>
      </body>
    </html>
  );
}
