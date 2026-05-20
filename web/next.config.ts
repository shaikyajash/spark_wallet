import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@buildonspark/spark-sdk", "bip39"],
  outputFileTracingRoot: __dirname,
  adapterPath: path.resolve(__dirname, "vercel-adapter-shim.js"),
};

export default nextConfig;
