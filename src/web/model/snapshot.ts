// Stable, detached snapshots can be consumed by React external stores later.
// Cloning at write boundaries prevents callers or injected services mutating saved views.
export function snapshot<T>(value: T): T {
  function freeze(item: unknown): void {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  }
  const copy = structuredClone(value);
  freeze(copy);
  return copy;
}
