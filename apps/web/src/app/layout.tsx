import type { Metadata, Viewport } from "next";
import "./globals.css";
import "../components/workspace.css";
export const metadata: Metadata = { title: "Faceless Studio", description: "Your private workspace for faceless video production.", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#111216" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="id"><body>{children}</body></html>; }
