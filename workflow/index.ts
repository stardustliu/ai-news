import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import { podcastTitle } from '@/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { synthesize } from '@echristian/edge-tts'
import { generateText } from 'ai'
import { WorkflowEntrypoint } from 'cloudflare:workers'
import { introPrompt, summarizeBlogPrompt, summarizePodcastPrompt, summarizeStoryPrompt } from './prompt'
import { fetchers } from './utils'

interface Params {
  today?: string
  source?: string
}

const retryConfig: WorkflowStepConfig = {
  retries: {
    limit: 5,
    delay: '10 seconds',
    backoff: 'exponential',
  },
  timeout: '3 minutes',
}

export class HackerNewsWorkflow extends WorkflowEntrypoint<CloudflareEnv, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    console.info('trigged event: HackerNewsWorkflow', event)

    const runEnv = this.env.NEXTJS_ENV || 'production'
    const isDev = runEnv === 'development'
    const today = event.payload.today || new Date().toISOString().split('T')[0]
    const source = event.payload.source || 'hacker-news'

    const fetcher = fetchers[source]
    if (!fetcher) {
      throw new Error(`No fetcher found for source: ${source}`)
    }

    const openai = createOpenAICompatible({
      name: 'openai',
      baseURL: this.env.OPENAI_BASE_URL!,
      headers: {
        Authorization: `Bearer ${this.env.OPENAI_API_KEY!}`,
      },
    })
    const maxTokens = Number.parseInt(this.env.OPENAI_MAX_TOKENS || '4096')

    const stories = await step.do(`get top stories ${today}`, retryConfig, async () => {
      return await fetcher.getTopStories(today, this.env.JINA_KEY)
    })

    if (!stories.length) {
      throw new Error('no stories found')
    }

    stories.length = Math.min(stories.length, isDev ? 10 : 10)
    console.info('top stories', isDev ? stories : JSON.stringify(stories))

    const allStories: string[] = []

    for (const story of stories) {
      const storyResponse = await step.do(`get story ${story.id}: ${story.title}`, retryConfig, async () => {
        return await fetcher.getStory(story, maxTokens, this.env.JINA_KEY)
      })

      console.info(`get story ${story.id} content success`)

      const text = await step.do(`summarize story ${story.id}: ${story.title}`, retryConfig, async () => {
        const { text, usage, finishReason } = await generateText({
          model: openai(this.env.OPENAI_MODEL!),
          system: summarizeStoryPrompt,
          prompt: storyResponse,
        })

        console.info(`get story ${story.id} summary success`, { text, usage, finishReason })
        return text
      })

      allStories.push(text)

      await step.sleep('Give AI a break', isDev ? '2 seconds' : '10 seconds')
    }

    const podcastContent = await step.do('create podcast content', retryConfig, async () => {
      const { text, usage, finishReason } = await generateText({
        model: openai(this.env.OPENAI_MODEL!),
        system: summarizePodcastPrompt,
        prompt: allStories.join('\n\n---\n\n'),
        maxTokens,
        maxRetries: 3,
      })

      console.info(`create ${source} podcast content success`, { text, usage, finishReason })

      return text
    })

    console.info('podcast content:\n', isDev ? podcastContent : podcastContent.slice(0, 100))

    await step.sleep('Give AI a break', isDev ? '2 seconds' : '10 seconds')

    const blogContent = await step.do('create blog content', retryConfig, async () => {
      const { text, usage, finishReason } = await generateText({
        model: openai(this.env.OPENAI_MODEL!),
        system: summarizeBlogPrompt,
        prompt: allStories.join('\n\n---\n\n'),
        maxTokens,
        maxRetries: 3,
      })

      console.info(`create ${source} daily blog content success`, { text, usage, finishReason })

      return text
    })

    console.info('blog content:\n', isDev ? blogContent : blogContent.slice(0, 100))

    await step.sleep('Give AI a break', isDev ? '2 seconds' : '10 seconds')

    const introContent = await step.do('create intro content', retryConfig, async () => {
      const { text, usage, finishReason } = await generateText({
        model: openai(this.env.OPENAI_MODEL!),
        system: introPrompt,
        prompt: podcastContent,
        maxRetries: 3,
      })

      console.info(`create intro content success`, { text, usage, finishReason })

      return text
    })

    const contentKey = `content:${runEnv}:${source}:${today}`
    const podcastKey = `${today.replaceAll('-', '/')}/${runEnv}/${source}-${today}.mp3`

    await step.do('create podcast audio', { ...retryConfig, timeout: '5 minutes' }, async () => {
      const { audio } = await synthesize({
        text: podcastContent,
        language: 'zh-CN',
        voice: this.env.AUDIO_VOICE_ID || 'zh-CN-XiaoxiaoNeural',
        rate: this.env.AUDIO_SPEED || '10%',
      })

      await this.env.HACKER_NEWS_R2.put(podcastKey, audio)

      const podcast = await this.env.HACKER_NEWS_R2.head(podcastKey)

      if (!podcast || podcast.size < audio.size) {
        throw new Error('podcast not found')
      }

      return 'OK'
    })

    console.info('save podcast to r2 success')

    await step.do('save content to kv', retryConfig, async () => {
      await this.env.HACKER_NEWS_KV.put(contentKey, JSON.stringify({
        date: today,
        title: `${podcastTitle} ${today}`,
        source,
        stories,
        podcastContent,
        blogContent,
        introContent,
        audio: podcastKey,
        updatedAt: Date.now(),
      }))

      return 'OK'
    })

    console.info('save content to kv success')
  }
}
