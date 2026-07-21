import type { NextConfig } from "next";

// pdf-parse ships a Node-native canvas helper alongside its embedded PDF
// worker. Keeping these server-only packages external prevents Turbopack from
// trying to place the native binary in an ESM route chunk.
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
