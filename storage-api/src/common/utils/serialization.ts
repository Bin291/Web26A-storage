/**
 * BigInt không serialize được bằng JSON.stringify mặc định (File.size là BigInt,
 * mục 7.B). Interceptor toàn cục (transform-bigint.interceptor) chuyển mọi BigInt
 * trong response thành string an toàn cho JSON.
 */
export function serializeBigInt(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => serializeBigInt(v));
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeBigInt(v);
    }
    return out;
  }
  return value;
}
