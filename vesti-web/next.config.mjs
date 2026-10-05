/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@vesti/ui"],
  experimental: {
    externalDir: true,
  },
}

export default nextConfig
