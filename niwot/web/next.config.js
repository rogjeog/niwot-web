/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Autoriser les images distantes si jamais tu utilises <Image />
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'api-game.niwot.btsinfo.nc' },
      { protocol: 'https', hostname: 'niwot.btsinfo.nc' },
    ],
  },
  async rewrites() {
    return [
      // Proxy des uploads -> API
      {
        source: '/uploads/:path*',
        destination: 'https://api-game.niwot.btsinfo.nc/uploads/:path*',
      },
    ];
  },
};

export default nextConfig;
