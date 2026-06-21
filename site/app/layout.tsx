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
  title: "loopEng | Turn repeated terminal work into callable MCP tools",
  description:
    "loopEng watches repeated terminal work across Claude Code and Codex sessions, then turns approved habits into callable MCP tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-mono">
        <LocaleProvider><HtmlLangSync />{children}</LocaleProvider>
      </body>
    </html>
  );
}
