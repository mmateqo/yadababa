import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  metadataBase: new URL("https://selora.example"),
  title: {
    default: "Selora",
    template: "%s — Selora",
  },
  description:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  applicationName: "Selora",
  openGraph: {
    title: "Selora",
    description:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.",
    type: "website",
    siteName: "Selora",
  },
  twitter: { card: "summary_large_image", title: "Selora" },
  icons: { icon: "/icons/shark.svg" },
};

export const viewport: Viewport = {
  themeColor: "#05080c",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
