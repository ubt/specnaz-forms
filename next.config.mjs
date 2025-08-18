/** @type {import('next').NextConfig} */
const nextConfig = {
  // Оптимизации для Cloudflare Pages
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  
  // Улучшенные настройки для Edge Runtime
  experimental: {
    serverComponentsExternalPackages: ['@notionhq/client'],
    // Отключаем ненужные экспериментальные функции для стабильности
    appDir: true,
    runtime: 'edge'
  },
  
  // Оптимизация компиляции
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { 
      exclude: ['error', 'warn', 'info'] 
    } : false,
  },
  
  // Оптимизированный webpack для Edge Runtime
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
      
      // Оптимизация для быстрой загрузки
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          minSize: 20000,
          maxSize: 244000,
        }
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
  
  // Настройки для статического экспорта (если потребуется)
  distDir: '.next',
  
  // Отключаем функции, которые могут конфликтовать с Edge Runtime
  swcMinify: true,
  
  // Настройки заголовков для кэширования
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ];
  },
  
  // Настройки переписывания для оптимизации
  async rewrites() {
    return [
      // Переписывания при необходимости
    ];
  },
};

export default nextConfig; 