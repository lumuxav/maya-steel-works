import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./profile-overrides.css";
import "./preferences.css";
import "./mobile-native.css";
import AppShell from "./components/AppShell";
import PwaRegister from "./components/PwaRegister";
import SystemChrome from "./components/SystemChrome";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Maya Steel Works Management",
  description: "Operations, stock, sales, production and cash management for Maya Steel Works.",
  applicationName: "Maya Steel Works",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Maya Steel Works",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f6fa",
};

export default function RootLayout({ children }) {
  const themeScript = `
    try {
      const saved = localStorage.getItem('maya-theme') || 'light';
      document.documentElement.dataset.theme = saved;
      const display = JSON.parse(localStorage.getItem('maya-display-preferences') || '{}');
      document.documentElement.dataset.density = display.density || 'comfortable';
      document.documentElement.dataset.motion = display.reducedMotion ? 'reduced' : 'normal';
    } catch (e) {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.dataset.density = 'comfortable';
      document.documentElement.dataset.motion = 'normal';
    }
  `;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <SystemChrome />
        <PwaRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
