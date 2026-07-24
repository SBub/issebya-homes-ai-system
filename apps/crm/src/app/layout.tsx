import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "CRM",
};

// Wrapping in Radix Themes' <Theme> (and importing its stylesheet above) is
// required for any @radix-ui/themes component used by src/app/page.tsx (the
// new v1 CRM dashboard) to render correctly at all — without it, Table/Card/
// Badge/etc. render unstyled.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Theme>{children}</Theme>
      </body>
    </html>
  );
}
