export const money = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}m` : `$${Math.round(v / 1000)}k`);
