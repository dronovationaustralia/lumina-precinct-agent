/**
 * A small in-memory cache for heavy map layers (land use clipped to 2 km, SAM polygons). The
 * underlying data only changes when it is reloaded with db:setup, which restarts nothing, so
 * entries expire after a few hours. Oldest entries are dropped beyond `max`.
 */
export class LayerCache<T> {
  private map = new Map<string, { at: number; value: Promise<T> }>();
  constructor(private max = 60, private ttlMs = 6 * 3600_000) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.map.set(key, { at: Date.now(), value });
    // A failed load is not cached.
    value.catch(() => this.map.delete(key));
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
    return value;
  }
}
