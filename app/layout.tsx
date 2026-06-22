import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LollaSchedule",
  description: "Build your optimal Lollapalooza 2026 schedule from your Spotify listening history",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Spotify bans `localhost` in redirect URIs, so the app must run on
            127.0.0.1. If the user lands on localhost, bounce them before any
            cookie is set — otherwise the PKCE cookie ends up on the wrong host. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(location.hostname==='localhost'){location.replace(location.href.replace('//localhost','//127.0.0.1'));}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
