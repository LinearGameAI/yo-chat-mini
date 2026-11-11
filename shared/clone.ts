// Catalogs, subtitles and watch state are plain JSON data, including undefined
// optional properties. No Dates, Maps, cycles or transferable objects are used.
export function cloneState<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
