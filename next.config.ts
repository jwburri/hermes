import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse loads a pdfjs worker by file path at runtime; bundling it breaks
  // that lookup, so leave it (and pdfjs) as plain node_modules imports.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  // Hermes_Brain.md is read from disk at runtime (it is the single source of the
  // system prompt, never copied into code). Tell the file tracer to bundle it
  // into the answer function so it ships with the Vercel deployment.
  outputFileTracingIncludes: {
    "/api/answer": ["./Hermes_Brain.md"],
  },
  // Internal tool: tell every crawler not to index any response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
