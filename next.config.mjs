/** @type {import('next').NextConfig} */
const nextConfig = {
  // Убираем output: 'export' - это вызывает проблемы с динамическими роутами
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  reactStrictMode: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  webpack: (config, { dev, isServer }) => {
    // Исправляем проблемы с self/window в SSR
    if (!dev && !isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;