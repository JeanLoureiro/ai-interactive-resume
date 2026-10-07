import type { NextConfig } from "next";

// The knowledge base is imported as JSON rather than read from disk at request time, so it is
// bundled with the route and needs no file-tracing configuration to survive deployment.
const nextConfig: NextConfig = {};

export default nextConfig;
