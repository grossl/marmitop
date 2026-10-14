/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@mt/ui'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
