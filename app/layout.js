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

export const metadata = {
  title: "Maya Steel Works Management",
  description: "Operations, stock, sales, production and cash management for Maya Steel Works.",
};

export default function RootLayout({ children }) {
  const themeScript = `
    try {
      const saved = localStorage.getItem('maya-theme') || 'blue';
      document.documentElement.dataset.theme = saved;
    } catch (e) {
      document.documentElement.dataset.theme = 'blue';
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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
