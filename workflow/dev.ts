import type { Env } from '../cloudflare-env'
import worker from '../worker'

export * from './'

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url)

    if (url.pathname === '/workflow') {
      // 创建一个模拟的 ScheduledEvent
      const event = new Event('scheduled') as ScheduledEvent
      return worker.scheduled(event, env, ctx)
    }

    if (url.pathname === '/status') {
      const instances = await env.HACKER_NEWS_WORKFLOW.list()
      return new Response(JSON.stringify(instances, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Workflow API', {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
}
