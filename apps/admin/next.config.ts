import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@maxcar/shared', '@maxcar/business-rules'],
};

export default nextConfig;
