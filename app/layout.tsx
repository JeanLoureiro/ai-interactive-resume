import type { Metadata } from "next";
import { getSubject } from "@/lib/config";
import "./globals.css";

export function generateMetadata(): Metadata {
  const { name, shortName } = getSubject();
  return {
    title: `Ask about ${shortName}`,
    description: `A source-grounded assistant that answers interview questions about ${name}'s background, and says so when it cannot cite an answer.`,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
