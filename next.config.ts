import type { NextConfig } from "next";

// Both caps below must stay comfortably above the largest ceiling in
// lib/upload-limits.ts's UPLOAD_CEILINGS (currently 20MB, jobEvidence) --
// see the guard test in lib/upload-limits.test.ts. Falling below it does
// NOT produce a clean rejection: proxyClientMaxBodySize silently truncates
// the buffered request body when exceeded, which then crashes the
// multipart form parser downstream with a confusing "Unexpected end of
// form" 500 instead of this app's own validation error.
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
