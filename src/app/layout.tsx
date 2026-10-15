import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fahad Real Estate | Rahim Yar Khan",
  description:
    "Fahad Real Estate property management for Fahad Garden Housing Scheme, Abdullah City, Taj Commercial Center, VIP Block and University Commercial Centers in Rahim Yar Khan, Pakistan.",
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
