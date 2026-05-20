import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@buildonspark/spark-sdk", "bip39"],
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
