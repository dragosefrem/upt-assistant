import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { LocaleProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const editorial = Instrument_Serif({ variable: "--font-editorial", weight: "400", style: "italic", subsets: ["latin", "latin-ext"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t.common.appName, template: `%s · ${t.common.appName}` },
    description: t.common.tagline,
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f48c4" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} ${editorial.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
