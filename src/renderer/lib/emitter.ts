type Listener<T> = (value: T) => void

/** Tiny typed event emitter for renderer-side classes. */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {}

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners[event]
    if (!set) this.listeners[event] = set = new Set()
    set.add(listener)
    return () => set!.delete(listener)
  }

  protected emit<K extends keyof Events>(event: K, value: Events[K]): void {
    for (const listener of [...(this.listeners[event] ?? [])]) {
      try {
        listener(value)
      } catch (err) {
        console.error(`listener for ${String(event)} failed`, err)
      }
    }
  }

  removeAllListeners(): void {
    this.listeners = {}
  }
}
