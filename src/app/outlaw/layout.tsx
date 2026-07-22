import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Outlaw",
};

export default function OutlawLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
