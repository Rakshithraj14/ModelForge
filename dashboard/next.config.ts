import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Plain static site: `next build` writes HTML/CSS/JS to out/, no server needed.
  output: "export",
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
