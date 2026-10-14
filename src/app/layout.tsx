import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PakLand Agentic REMS | Real Estate Management System",
  description:
    "Production-grade Agentic Real Estate Management System for Housing Schemes, Commercial Centers, Landlords & Agencies in Pakistan.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr">
      <body className="min-h-screen bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
