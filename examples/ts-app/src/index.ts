export type User = { id: number; name: string }

export function greet(u: User): string {
  return `hello ${u.name}`
}

export class Store<T> {
  private items = new Map<number, T>()
  set(id: number, v: T) { this.items.set(id, v) }
  get(id: number) { return this.items.get(id) }
}
