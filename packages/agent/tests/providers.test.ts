import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock refs (vi.mock is hoisted, vi.fn() must be in vi.hoisted) ──
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
const { mockStreamAndAccumulate } = vi.hoisted(() => ({
  mockStreamAndAccumulate: vi.fn(),
}))

// ── Mock OpenAI SDK (affects all providers) ──
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  },
}))

// ── Mock streamAndAccumulate (used by DeepSeekProvider.stream) ──
vi.mock('../src/llm.js', () => ({
  streamAndAccumulate: mockStreamAndAccumulate,
}))

// ── Imports (after mocks) ──
import { DeepSeekProvider } from '../src/providers/deepseek-provider.js'
import { OpenAIProvider } from '../src/providers/openai-provider.js'
import { MiniMaxProvider } from '../src/providers/minimax-provider.js'
import { createLLMProvider } from '../src/providers/llm-provider.js'
import type { StreamCallbacks } from '../src/llm.js'

// ═══════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════

/** Build an async iterable from an array of streaming chunks. */
async function* asyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}

/** A single streaming chunk shape consumed by providers. */
interface DeltaChunk {
  choices: Array<{
    delta: {
      content?: string
      reasoning_content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
}

const COMMON_CONFIG = {
  apiKey: 'test-key',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4',
}

// ═══════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════

beforeEach(() => {
  vi.clearAllMocks()
})

// ── DeepSeekProvider ──

describe('DeepSeekProvider', () => {
  const provider = new DeepSeekProvider({
    apiKey: 'test-ds-key',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
  })

  describe('chat()', () => {
    it('returns content and toolCalls from API response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Hello from DeepSeek',
              tool_calls: [
                {
                  id: 'call_1',
                  function: { name: 'read_file', arguments: '{"path":"x.py"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const result = await provider.chat([{ role: 'user', content: 'Hi' }])

      expect(result.content).toBe('Hello from DeepSeek')
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('read_file')
      expect(result.toolCalls[0].arguments).toEqual({ path: 'x.py' })
      expect(result.reasoning).toBeNull()
      expect(result.usage?.totalTokens).toBe(15)
    })

    it('returns empty content when no message choice', async () => {
      mockCreate.mockResolvedValueOnce({ choices: [{}] })

      const result = await provider.chat([{ role: 'user', content: 'Hi' }])
      expect(result.content).toBe('')
      expect(result.toolCalls).toEqual([])
    })
  })

  describe('stream()', () => {
    it('delegates to streamAndAccumulate with client + messages + tools + callbacks', async () => {
      mockStreamAndAccumulate.mockResolvedValueOnce({
        content: 'streamed answer',
        reasoning: null,
        toolCalls: [],
      })

      const msgs = [{ role: 'user' as const, content: 'Hi' }]
      const tools: Record<string, unknown>[] = []
      const callbacks: StreamCallbacks = { onToken: vi.fn() }

      const result = await provider.stream(msgs, tools, callbacks)

      expect(result.content).toBe('streamed answer')
      expect(mockStreamAndAccumulate).toHaveBeenCalledTimes(1)
      expect(mockStreamAndAccumulate).toHaveBeenCalledWith(
        expect.anything(), // client
        msgs,
        tools,
        callbacks,
      )
    })
  })

  describe('model', () => {
    it('returns the configured model', () => {
      expect(provider.model).toBe('deepseek-v4-pro')
    })
  })
})

// ── OpenAIProvider ──

describe('OpenAIProvider', () => {
  const provider = new OpenAIProvider(COMMON_CONFIG)

  describe('chat()', () => {
    it('returns content and usage from non-streaming API', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Hello from OpenAI',
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      })

      const result = await provider.chat([{ role: 'user', content: 'Hi' }])

      expect(result.content).toBe('Hello from OpenAI')
      expect(result.toolCalls).toEqual([])
      expect(result.usage?.totalTokens).toBe(15)
    })

    it('parses tool_calls from response', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'tc-1',
                  function: {
                    name: 'search',
                    arguments: '{"query":"weather"}',
                  },
                },
              ],
            },
          },
        ],
      })

      const result = await provider.chat([{ role: 'user', content: 'Search' }])
      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe('search')
      expect(result.toolCalls[0].arguments).toEqual({ query: 'weather' })
    })
  })

  describe('stream()', () => {
    it('streams content and fires onToken callback', async () => {
      const chunks: DeltaChunk[] = [
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo ' } }] },
        { choices: [{ delta: { content: 'world' } }] },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const onToken = vi.fn()
      const result = await provider.stream(
        [{ role: 'user', content: 'Hi' }],
        [],
        { onToken },
      )

      expect(result.content).toBe('Hello world')
      expect(result.toolCalls).toEqual([])
      // Each character triggers a separate onToken call
      expect(onToken).toHaveBeenCalledTimes('Hello world'.length)
      expect(onToken).toHaveBeenNthCalledWith(1, 'H')
      expect(onToken).toHaveBeenNthCalledWith(4, 'l')
    })

    it('fires onReasoning for reasoning_content', async () => {
      const chunks: DeltaChunk[] = [
        { choices: [{ delta: { reasoning_content: 'Let' } }] },
        { choices: [{ delta: { reasoning_content: ' me think' } }] },
        { choices: [{ delta: { content: 'Answer: 42' } }] },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const onReasoning = vi.fn()
      const onToken = vi.fn()
      const result = await provider.stream(
        [{ role: 'user', content: '?' }],
        [],
        { onReasoning, onToken },
      )

      expect(result.reasoning).toBe('Let me think')
      expect(result.content).toBe('Answer: 42')
      // reasoning chars should fire callback
      expect(onReasoning).toHaveBeenCalledTimes('Let me think'.length)
      expect(onToken).toHaveBeenCalledTimes('Answer: 42'.length)
    })

    it('assembles incremental tool_calls and fires onToolCall', async () => {
      const chunks: DeltaChunk[] = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'tc-1', function: { name: 'read_file', arguments: '' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '{"path":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: ' "test.txt"}' } },
                ],
              },
            },
          ],
        },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const onToolCall = vi.fn()
      const result = await provider.stream(
        [{ role: 'user', content: 'Read' }],
        [],
        { onToolCall },
      )

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].id).toBe('tc-1')
      expect(result.toolCalls[0].name).toBe('read_file')
      expect(result.toolCalls[0].arguments).toEqual({ path: 'test.txt' })

      // onToolCall fires once per assembled tool call
      expect(onToolCall).toHaveBeenCalledTimes(1)
      expect(onToolCall).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tc-1', name: 'read_file' }),
      )
    })

    it('handles empty choices gracefully', async () => {
      const chunks: DeltaChunk[] = [
        { choices: [{ delta: {} }] },
        { choices: [] as any },
        { choices: [{ delta: { content: 'final' } }] },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const result = await provider.stream(
        [{ role: 'user', content: 'Hi' }],
        [],
      )

      expect(result.content).toBe('final')
    })

    it('handles tool_calls with no arguments gracefully', async () => {
      const chunks: DeltaChunk[] = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'tc-1', function: { name: 'ping', arguments: '' } },
                ],
              },
            },
          ],
        },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const result = await provider.stream(
        [{ role: 'user', content: 'Ping' }],
        [],
      )

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].arguments).toEqual({})
    })
  })

  describe('model', () => {
    it('returns the configured model', () => {
      expect(provider.model).toBe('gpt-4')
    })
  })
})

// ── MiniMaxProvider ──

describe('MiniMaxProvider', () => {
  const provider = new MiniMaxProvider({
    apiKey: 'test-mm-key',
    baseURL: 'https://api.minimax.chat/v1',
    model: 'abab6.5s-chat',
  })

  describe('chat()', () => {
    it('strips think tags from content', async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '</think>Let me calculate</think>The answer is 42',
            },
          },
        ],
      })

      const result = await provider.chat([{ role: 'user', content: '?' }])

      // Both opening and closing think tags are stripped
      expect(result.content).toBe('Let me calculateThe answer is 42')
      expect(result.reasoning).toBeNull()
    })
  })

  describe('stream()', () => {
    it('separates reasoning (think tags) from content and fires callbacks', async () => {
      const chunks: DeltaChunk[] = [
        { choices: [{ delta: { content: '</think>' } }] },
        { choices: [{ delta: { content: 'cal' } }] },
        { choices: [{ delta: { content: 'culating' } }] },
        { choices: [{ delta: { content: '</think>' } }] },
        { choices: [{ delta: { content: 'Ans' } }] },
        { choices: [{ delta: { content: 'wer: 42' } }] },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const onToken = vi.fn()
      const onReasoning = vi.fn()
      const result = await provider.stream(
        [{ role: 'user', content: '?' }],
        [],
        { onToken, onReasoning },
      )

      expect(result.reasoning).toBe('calculating')
      expect(result.content).toBe('Answer: 42')
      // reasoning chars should fire callback
      // MiniMaxProvider emits reasoning per buffer chunk, not char-by-char
      expect(onReasoning).toHaveBeenCalledTimes(3)
      expect(onToken).toHaveBeenCalledTimes('Answer: 42'.length)
    })

    it('handles no think tags — all content, no reasoning', async () => {
      const chunks: DeltaChunk[] = [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const result = await provider.stream(
        [{ role: 'user', content: 'Hi' }],
        [],
      )

      expect(result.content).toBe('Hello world')
      expect(result.reasoning).toBeNull()
    })

    it('handles unclosed think tag — trailing content becomes reasoning', async () => {
      const chunks: DeltaChunk[] = [
        { choices: [{ delta: { content: '</think>' } }] },
        { choices: [{ delta: { content: 'unclosed' } }] },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const result = await provider.stream(
        [{ role: 'user', content: '?' }],
        [],
      )

      expect(result.content).toBe('')
      expect(result.reasoning).toBe('unclosed')
    })

    it('assembles incremental tool_calls', async () => {
      const chunks: DeltaChunk[] = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'mm-tc', function: { name: 'search', arguments: '' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '{"q":"weath' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'er"}' } },
                ],
              },
            },
          ],
        },
      ]
      mockCreate.mockResolvedValueOnce(asyncIterable(chunks))

      const onToolCall = vi.fn()
      const result = await provider.stream(
        [{ role: 'user', content: 'Search' }],
        [],
        { onToolCall },
      )

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].id).toBe('mm-tc')
      expect(result.toolCalls[0].name).toBe('search')
      expect(result.toolCalls[0].arguments).toEqual({ q: 'weather' })
      expect(onToolCall).toHaveBeenCalledTimes(1)
    })
  })

  describe('model', () => {
    it('returns the configured model', () => {
      expect(provider.model).toBe('abab6.5s-chat')
    })
  })
})

// ── createLLMProvider factory ──

describe('createLLMProvider', () => {
  it('creates DeepSeekProvider for deepseek baseURL', async () => {
    const provider = await createLLMProvider({
      apiKey: 'key',
      baseURL: 'https://api.deepseek.com',
      model: 'ds-model',
    })
    expect(provider).toBeInstanceOf(DeepSeekProvider)
  })

  it('creates MiniMaxProvider for minimax baseURL', async () => {
    const provider = await createLLMProvider({
      apiKey: 'key',
      baseURL: 'https://api.minimax.chat/v1',
      model: 'mm-model',
    })
    expect(provider).toBeInstanceOf(MiniMaxProvider)
  })

  it('creates OpenAIProvider for other baseURLs', async () => {
    const provider = await createLLMProvider({
      apiKey: 'key',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4',
    })
    expect(provider).toBeInstanceOf(OpenAIProvider)
  })
})
