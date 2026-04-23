/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ""

const nextConfig = {
  ...(basePath ? { basePath } : {}),
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  webpack: (config) => {
    // lightweight-charts v5 ships an exports field with non-standard
    // "production"/"development" conditions. Webpack (in Next 14) won't
    // resolve those automatically, so we alias the bare import directly to
    // its production build file. This preserves Next's default conditionNames
    // for every other package.
    const path = require("path")
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "lightweight-charts$": path.resolve(
        __dirname,
        "node_modules/lightweight-charts/dist/lightweight-charts.production.mjs"
      ),
    }
    return config
  },
}

module.exports = nextConfig
