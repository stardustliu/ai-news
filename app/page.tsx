import { ArticleCard } from '@/components/article-card'
import { keepDays } from '@/config'
import { getPastDays } from '@/lib/utils'
import { getCloudflareContext } from '@opennextjs/cloudflare'

export const dynamic = 'force-dynamic'
export const revalidate = 300

export default async function Home() {
  const { env } = getCloudflareContext()
  const runEnv = env.NEXTJS_ENV
  const pastDays = getPastDays(keepDays)
  const posts = (await Promise.all(
    pastDays.map(async (day) => {
      try {
        const post = await env.HACKER_NEWS_KV.get(`content:${runEnv}:hacker-news:${day}`, 'json')
        if (!post)
          return null
        return post as Article
      }
      catch (error) {
        console.error(`Error fetching post for day ${day}:`, error)
        return null
      }
    }),
  )).filter((post): post is Article => post !== null)

  return (
    <>
      {posts.map(post => (
        <ArticleCard
          key={post.date}
          article={post}
          staticHost={env.NEXT_STATIC_HOST}
          showSummary
        />
      ))}
    </>
  )
}
