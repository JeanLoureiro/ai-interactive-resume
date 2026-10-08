import type { NextConfig } from "next";

// The knowledge base is imported as JSON rather than read from disk at request time, so it is
// bundled with the route and needs no file-tracing configuration to survive deployment.
const nextConfig: NextConfig = {
  // Native ONNX runtime and its JS wrapper load from node_modules at run time; bundling them breaks.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  // The embedding model's files, fetched by `pnpm build`, must ship with the function that uses them.
  outputFileTracingIncludes: { "/api/ask": ["./models/**/*"] },
};

export default nextConfig;
