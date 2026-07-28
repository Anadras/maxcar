import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@maxcar/shared', '@maxcar/business-rules'],
  experimental: {
    serverActions: {
      bodySizeLimit: '55mb',
    },
  },
};

export default nextConfig;
