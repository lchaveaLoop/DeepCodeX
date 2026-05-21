// Debug streaming timing
import 'dotenv/config'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: 'https://api.minimax.chat/v1',
})

async function debug() {
  console.log('Starting stream with timing...')
  const start = Date.now()

  const stream = await client.chat.completions.create({
    model: 'MiniMax-M2.7',
    messages: [{ role: 'user', content: 'count to 10' }],
    stream: true,
  })

  let charCount = 0
  let lastTime = start
  for await (const chunk of stream) {
    const now = Date.now()
    const delta = now - lastTime
    lastTime = now

    const content = chunk.choices?.[0]?.delta?.content
    if (content) {
      charCount++
      if (charCount <= 20 || charCount % 10 === 0) {
        console.log(`Char ${charCount}: "${content}" (${delta}ms)`)
      }
    }
  }

  const total = Date.now() - start
  console.log(`\nTotal: ${charCount} chars in ${total}ms, avg ${(total/charCount).toFixed(1)}ms per char`)
}

debug().catch(console.error)