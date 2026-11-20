import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and reads the session + SQLite at request time, so the
  // app renders dynamically instead of adopting Cache Components / static shells.
  serverExternalPackages: ["better-sqlite3", "exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
