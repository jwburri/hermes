import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hermes_Brain.md is read from disk at runtime (it is the single source of the
  // system prompt, never copied into code). Tell the file tracer to bundle it
  // into the answer function so it ships with the Vercel deployment.
  outputFileTracingIncludes: {
    "/api/answer": ["./Hermes_Brain.md"],
  },
};

export default nextConfig;
