import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ask about Jean",
  description:
    "A source-grounded assistant that answers interview questions about Jean Loureiro's background, and says so when it cannot cite an answer.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
