import process from 'node:process'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

// 确保在开发环境中初始化 Cloudflare Workers
if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev({
    bindings: {
      HACKER_NEWS_KV: {
        type: 'kv',
        id: '4d458dadadea42f8b8198fe3e29f858d',
      },
    },
  })
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  expireTime: 3600,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
