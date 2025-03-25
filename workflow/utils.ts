import type { Element } from 'cheerio'
import * as cheerio from 'cheerio'

// 定义通用的Story接口
export interface Story {
  id: string
  title: string
  url: string
  source: string // 新增：标识来源站点
  sourceUrl?: string // 新增：原始站点URL
}

// 定义抓取器接口
export interface ContentFetcher {
  getTopStories: (today: string, JINA_KEY?: string) => Promise<Story[]>
  getStory: (story: Story, maxTokens: number, JINA_KEY?: string) => Promise<string>
}

// Hacker News抓取器实现
export class HackerNewsFetcher implements ContentFetcher {
  async getTopStories(today: string, JINA_KEY?: string): Promise<Story[]> {
    const url = `https://news.ycombinator.com/front?day=${today}`
    const headers: HeadersInit = {
      'X-Retain-Images': 'none',
      'X-Return-Format': 'html',
    }

    if (JINA_KEY) {
      headers.Authorization = `Bearer ${JINA_KEY}`
    }
    console.info(`get top stories ${today} from ${url}`)
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers,
    })
    console.info(`get top stories result: ${response.statusText}`)
    const text = await response.text()

    const $ = cheerio.load(text)
    const stories: Story[] = $('.athing.submission').map((i: number, el: Element) => ({
      id: $(el).attr('id'),
      title: $(el).find('.titleline > a').text(),
      url: $(el).find('.titleline > a').attr('href'),
      source: 'hacker-news',
      sourceUrl: `https://news.ycombinator.com/item?id=${$(el).attr('id')}`,
    })).get()

    return stories.filter(story => story.id && story.url)
  }

  async getStory(story: Story, maxTokens: number, JINA_KEY?: string): Promise<string> {
    const headers: HeadersInit = {
      'X-Retain-Images': 'none',
    }

    if (JINA_KEY) {
      headers.Authorization = `Bearer ${JINA_KEY}`
    }

    const [article, comments] = await Promise.all([
      fetch(`https://r.jina.ai/${story.url}`, {
        headers,
      }).then((res) => {
        if (res.ok) {
          return res.text()
        }
        else {
          console.error(`get story failed: ${res.statusText}  ${story.url}`)
          return ''
        }
      }),
      fetch(`https://r.jina.ai/${story.sourceUrl}`, {
        headers: {
          ...headers,
          'X-Remove-Selector': '.navs',
          'X-Target-Selector': '#pagespace + tr',
        },
      }).then((res) => {
        if (res.ok) {
          return res.text()
        }
        else {
          console.error(`get story comments failed: ${res.statusText} ${story.sourceUrl}`)
          return ''
        }
      }),
    ])
    return [
      story.title
        ? `
<title>
${story.title}
</title>
`
        : '',
      article
        ? `
<article>
${article.substring(0, maxTokens * 4)}
</article>
`
        : '',
      comments
        ? `
<comments>
${comments.substring(0, maxTokens * 4)}
</comments>
`
        : '',
    ].filter(Boolean).join('\n\n---\n\n')
  }
}

// 示例：添加新的站点抓取器（以TechCrunch为例）
export class TechCrunchFetcher implements ContentFetcher {
  async getTopStories(today: string, JINA_KEY?: string): Promise<Story[]> {
    const url = 'https://techcrunch.com'
    const headers: HeadersInit = {
      'X-Retain-Images': 'none',
      'X-Return-Format': 'html',
    }

    if (JINA_KEY) {
      headers.Authorization = `Bearer ${JINA_KEY}`
    }

    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers,
    })
    const text = await response.text()
    const $ = cheerio.load(text)

    const stories: Story[] = $('article').map((i: number, el: Element) => ({
      id: $(el).attr('id') || `techcrunch-${i}`,
      title: $(el).find('h2').text().trim(),
      url: $(el).find('a').attr('href'),
      source: 'techcrunch',
      sourceUrl: $(el).find('a').attr('href'),
    })).get()

    return stories.filter(story => story.id && story.url)
  }

  async getStory(story: Story, maxTokens: number, JINA_KEY?: string): Promise<string> {
    const headers: HeadersInit = {
      'X-Retain-Images': 'none',
    }

    if (JINA_KEY) {
      headers.Authorization = `Bearer ${JINA_KEY}`
    }

    const article = await fetch(`https://r.jina.ai/${story.url}`, {
      headers,
    }).then((res) => {
      if (res.ok) {
        return res.text()
      }
      else {
        console.error(`get story failed: ${res.statusText}  ${story.url}`)
        return ''
      }
    })

    return [
      story.title
        ? `
<title>
${story.title}
</title>
`
        : '',
      article
        ? `
<article>
${article.substring(0, maxTokens * 4)}
</article>
`
        : '',
    ].filter(Boolean).join('\n\n---\n\n')
  }
}

// 导出所有抓取器
export const fetchers: Record<string, ContentFetcher> = {
  'hacker-news': new HackerNewsFetcher(),
  'techcrunch': new TechCrunchFetcher(),
}
