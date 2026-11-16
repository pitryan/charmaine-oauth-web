import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

"exclude": [
  "node_modules",
  "supabase/functions/**"
]

export default nextConfig;
