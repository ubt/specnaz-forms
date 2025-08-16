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
  
  // Улучшенные настройки для экспорта
  output: 'export',
  distDir: '.next',
  
  // Пропускаем проблемные маршруты при статической генерации
  exportPathMap: async function (defaultPathMap, { dev, dir, outDir, distDir, buildId }) {
    // Исключаем динамические маршруты из статической генерации
    const pathMap = {};
    
    // Добавляем только статические страницы
    pathMap['/'] = { page: '/' };
    pathMap['/admin'] = { page: '/admin' };
    pathMap['/diagnostic'] = { page: '/diagnostic' };
    
    return pathMap;
  },
  
  // Отключаем функции, которые могут конфликтовать с Edge Runtime
  swcMinify: true,
};

export default nextConfig;