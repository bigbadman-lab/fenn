import type { Metadata } from "next";

import { Providers } from "@/components/providers";
import { ApplicationShell } from "@/components/shell/application-shell";
import { buildRootMetadata } from "@/lib/site/metadata";

import "./globals.css";

export const metadata: Metadata = buildRootMetadata();

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
