// Debug MiniMax streaming
import 'dotenv/config'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: 'https://api.minimax.chat/v1',
})

async function debug() {
  console.log('Starting stream...')
  console.log('API Key:', process.env.MINIMAX_API_KEY ? 'set' : 'not set')

  const stream = await client.chat.completions.create({
    model: 'MiniMax-M2.7',
    messages: [{ role: 'user', content: 'count to 5' }],
    stream: true,
  })

  let count = 0
  for await (const chunk of stream) {
    count++
    if (count <= 10) {
      console.log('Chunk', count, ':', JSON.stringify(chunk, null, 2))
    }
    if (count === 10) {
      console.log('... (truncated)')
    }
    if (count >= 50) break
  }
  console.log('Total chunks:', count)
}

debug().catch(console.error)