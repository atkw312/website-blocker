import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "Sumi",
  description:
    "Remove algorithm traps and watch YouTube intentionally. Free Chrome extension with Pro features.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-ink text-paper antialiased">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  );
}
