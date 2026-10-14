/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mt/ui', '@mt/http', '@mt/db', '@mt/core', '@mt/schemas'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
