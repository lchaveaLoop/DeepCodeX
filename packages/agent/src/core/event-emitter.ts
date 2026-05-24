// Core event system for Agent

type EventHandler<T = unknown> = (data: T) => void | Promise<void>

export class EventEmitter {
  private listeners = new Map<string, Set<EventHandler>>()
  private onceHandlers = new Map<string, EventHandler>()

  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as EventHandler)

    return () => this.off(event, handler)
  }

  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.listeners.get(event)?.delete(handler as EventHandler)
  }

  emit(event: string, data?: unknown): void {
    const onceHandler = this.onceHandlers.get(event)
    if (onceHandler) {
      this.onceHandlers.delete(event)
      onceHandler(data)
    }

    const handlers = this.listeners.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(data)
          if (result instanceof Promise) {
            result.catch((err) => console.error(`Event handler error [${event}]:`, err))
          }
        } catch (err) {
          console.error(`Event handler error [${event}]:`, err)
        }
      }
    }
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.onceHandlers.set(event, handler as EventHandler)
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event)
      this.onceHandlers.delete(event)
    } else {
      this.listeners.clear()
      this.onceHandlers.clear()
    }
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }

  eventNames(): string[] {
    return [...new Set([...this.listeners.keys(), ...this.onceHandlers.keys()])]
  }
}
