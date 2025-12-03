/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  
  experimental: {
    serverComponentsExternalPackages: ['@notionhq/client']
  },
  
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { 
      exclude: ['error', 'warn', 'info'] 
    } : false,
  },
  
  webpack: (config, { isServer, nextRuntime }) => {
    if (nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, net: false, tls: false, crypto: false,
        stream: false, url: false, zlib: false, http: false,
        https: false, assert: false, os: false, path: false,
      };
      
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          minSize: 20000,
          maxSize: 244000,
        }
      };
    }
    
    if (!isServer) {
      config.resolve.fallback = { 
        ...config.resolve.fallback, 
        fs: false, net: false, tls: false 
      };
    }
    
    return config;
  },
  
  distDir: '.next',
  swcMinify: true,
  
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
};

export default nextConfig;
