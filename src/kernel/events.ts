export type Listener<T> = (payload: T) => void | Promise<void>

export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<any>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener<any>>()
    set.add(listener)
    this.listeners.set(event, set)
    return () => set.delete(listener)
  }

  async emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) await listener(payload)
  }
}
