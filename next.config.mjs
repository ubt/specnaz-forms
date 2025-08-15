/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    // strip console.* in production builds except error/warn
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  experimental: {
    // ensure edge features play nice; keep default app router settings
  },
  // Cloudflare Pages uses @cloudflare/next-on-pages; no special output needed here
};
export default nextConfig;
