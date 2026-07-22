import type { Metadata } from "next";

import { Providers } from "@/components/providers";
import { ApplicationShell } from "@/components/shell/application-shell";
import { publicEnv } from "@/lib/env/public";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: {
    default: "FENN",
    template: "%s — FENN",
  },
  description: "FENN. imfenn.com.",
  applicationName: "FENN",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ApplicationShell>{children}</ApplicationShell>
        </Providers>
      </body>
    </html>
  );
}
