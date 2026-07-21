import type { Metadata } from "next";
import "./globals.css";
import "./provenance.css";

export const metadata: Metadata = {
  title: "MEET — Opportunity intelligence",
  description: "A transparent opportunity-discovery system for the rooms, events, and builds that matter to you.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Some browser extensions add attributes to <html> before React hydrates.
  // This keeps those external mutations from producing a false-positive warning.
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
