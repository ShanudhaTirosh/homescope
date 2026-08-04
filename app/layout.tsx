import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HomeScope — Local Network Monitor",
  description:
    "A private local dashboard for every router, access point, and device on your home network.",
  icons: {
    icon: "/homescope-icon.png?v=3",
    shortcut: "/homescope-icon.png?v=3",
    apple: "/homescope-icon.png?v=3",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HomeScope",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#07100c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
