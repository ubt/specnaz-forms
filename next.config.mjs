// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  
  // Улучшенные настройки для Edge Runtime
  experimental: {
    serverComponentsExternalPackages: ['@notionhq/client'],
  },
  
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  
  webpack: (config, { dev, isServer, nextRuntime }) => {
    // Особые настройки для Edge Runtime
    if (nextRuntime === 'edge') {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }
    
    // Для клиентской сборки в продакшене
    if (!dev && !isServer) {
      config.resolve.fallback = { 
        ...config.resolve.fallback, 
        fs: false, 
        net: false, 
        tls: false 
      };
    }
    
    return config;
  },
  
  // Настройки для статического экспорта
  output: 'export',
  distDir: '.next',
  
  // Отключаем функции, которые могут конфликтовать с Edge Runtime
  swcMinify: true,
};

export default nextConfig;