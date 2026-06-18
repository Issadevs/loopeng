import type { Metadata } from "next";
import { Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import { LocaleProvider } from "@/lib/i18n";
import HtmlLangSync from "@/components/HtmlLangSync";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "loopEng — your manual workflows become tools your agents call",
  description:
    "loopEng watches what you do by hand in the terminal and turns the steps you keep repeating into callable MCP tools — so your AI agents can do them for you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${instrumentSerif.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-mono">
        <LocaleProvider><HtmlLangSync />{children}</LocaleProvider>
      </body>
    </html>
  );
}
