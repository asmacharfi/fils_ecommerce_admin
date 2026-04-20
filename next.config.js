/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["res.cloudinary.com"]
  },
  // Avoid multiple PrismaClient instances / duplicate engine in dev (helps P2037).
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
}

module.exports = nextConfig
