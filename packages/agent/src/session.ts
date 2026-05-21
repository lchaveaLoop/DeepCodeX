import fs from 'node:fs/promises'
import path from 'node:path'

export function saveSession(messages: Record<string, unknown>[], filepath: string): Promise<void> {
  const abs = path.resolve(filepath)
  return fs
    .mkdir(path.dirname(abs), { recursive: true })
    .then(() => fs.writeFile(abs, JSON.stringify(messages, null, 2), 'utf-8'))
}

export async function loadSession(filepath: string): Promise<Record<string, unknown>[]> {
  const abs = path.resolve(filepath)
  const raw = await fs.readFile(abs, 'utf-8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error('Session file must contain a JSON array of messages')
  }
  return data
}
