import type { BufferModel } from "../kernel/buffer"
import { modeLineage } from "../modes/mode"
import { registerCatalogEntry } from "./definitions"
import type { SourceLocation } from "./source"
import { captureCallerSource } from "./source"

/**
 * Open per-mode dispatch (Emacs `cl-defgeneric` / `cl-defmethod`).
 *
 * A generic is a named function whose implementation is selected by the
 * buffer's major mode. `defmethod` attaches an implementation to a mode;
 * dispatch walks `modeLineage` so a method on `prog-mode` applies to every
 * child until a more specific method shadows it. Third parties can add
 * methods without touching the `Mode` definition that owns the mode name.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (buffer: BufferModel, ...args: any[]) => any

/** Catch-all mode specializer; matches when no mode in the lineage has a method. */
export const GENERIC_DEFAULT_MODE = "t"

export type Generic<F extends AnyFn = AnyFn> = F & {
  readonly genericName: string
  /** Most-specific applicable method for `mode`, or undefined if none (not even "t"). */
  methodFor(mode: string): F | undefined
  /** Live view of registered methods keyed by mode name (includes "t"). */
  methods(): ReadonlyMap<string, F>
}

type Entry = {
  name: string
  doc?: string
  source?: SourceLocation
  fallback?: AnyFn
  methods: Map<string, AnyFn>
  dispatch: Generic
}

const generics = new Map<string, Entry>()

export type DefgenericOptions<F extends AnyFn> = {
  doc?: string
  /** Called when no method (including "t") is applicable. */
  fallback?: F
}

/**
 * Declare (or re-declare) a generic function. Returns a callable that
 * dispatches on its first argument's `mode`. Idempotent: a second call with
 * the same name returns the same dispatch function so hot-reload and module
 * re-import don't orphan previously registered methods.
 */
export function defgeneric<F extends AnyFn>(name: string, opts: DefgenericOptions<F> = {}): Generic<F> {
  const source = captureCallerSource(3)
  let entry = generics.get(name)
  if (!entry) {
    const methods = new Map<string, AnyFn>()
    const dispatch = makeDispatch(name, methods)
    entry = { name, methods, dispatch, doc: opts.doc, fallback: opts.fallback, source }
    generics.set(name, entry)
  } else {
    if (opts.doc !== undefined) entry.doc = opts.doc
    if (opts.fallback !== undefined) entry.fallback = opts.fallback
    if (source) entry.source = source
  }
  registerCatalogEntry({ kind: "function", name, source: entry.source, doc: entry.doc })
  return entry.dispatch as Generic<F>
}

/**
 * Register `fn` as the implementation of generic `name` for `mode`.
 * `mode` may be any major-mode name, or `"t"` for the catch-all default.
 * The generic is auto-declared if it doesn't exist yet so load order between
 * `defgeneric` and `defmethod` is irrelevant.
 */
export function defmethod<F extends AnyFn>(name: string, mode: string, fn: F, source?: SourceLocation): Generic<F> {
  const loc = source ?? captureCallerSource(3)
  const entry = generics.get(name) ?? createEntry(name)
  entry.methods.set(mode, fn)
  registerCatalogEntry({ kind: "function", name, detail: mode, source: loc, doc: `Method on ${name} for ${mode}` })
  return entry.dispatch as Generic<F>
}

/** Look up a declared generic by name without creating it. */
export function getGeneric<F extends AnyFn = AnyFn>(name: string): Generic<F> | undefined {
  return generics.get(name)?.dispatch as Generic<F> | undefined
}

/** Invoke a generic by name. Returns `undefined` if the generic is unknown. */
export function callGeneric<R = unknown>(name: string, buffer: BufferModel, ...args: unknown[]): R | undefined {
  const entry = generics.get(name)
  if (!entry) return undefined
  return (entry.dispatch as AnyFn)(buffer, ...args) as R | undefined
}

/** Resolve the method that would run for `mode` without invoking it. */
export function methodFor<F extends AnyFn = AnyFn>(name: string, mode: string): F | undefined {
  const entry = generics.get(name)
  if (!entry) return undefined
  return resolve(entry, mode) as F | undefined
}

export function removeMethod(name: string, mode: string): boolean {
  return generics.get(name)?.methods.delete(mode) ?? false
}

export function listGenerics(): string[] {
  return [...generics.keys()].sort()
}

/** Test/reload helper: drop all generics, or one entirely (methods + fallback). */
export function clearGenerics(name?: string): void {
  if (name) generics.delete(name)
  else generics.clear()
}

function createEntry(name: string): Entry {
  const methods = new Map<string, AnyFn>()
  const dispatch = makeDispatch(name, methods)
  const entry: Entry = { name, methods, dispatch }
  generics.set(name, entry)
  return entry
}

function resolve(entry: Entry, mode: string): AnyFn | undefined {
  for (const m of modeLineage(mode)) {
    const fn = entry.methods.get(m.name)
    if (fn) return fn
  }
  return entry.methods.get(GENERIC_DEFAULT_MODE) ?? entry.fallback
}

function makeDispatch(name: string, methods: Map<string, AnyFn>): Generic {
  const fn = ((buffer: BufferModel, ...args: unknown[]) => {
    const entry = generics.get(name)
    if (!entry) return undefined
    return resolve(entry, buffer.mode)?.(buffer, ...args)
  }) as Generic
  Object.defineProperty(fn, "genericName", { value: name })
  fn.methodFor = mode => {
    const entry = generics.get(name)
    return entry ? resolve(entry, mode) : undefined
  }
  fn.methods = () => methods
  return fn
}
