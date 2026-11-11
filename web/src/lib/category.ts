// Seat categories. Mirrors contracts/nearseat/src/category.rs: the category is
// decided by where the seat is, and sets its price and its share of the pool.
export type Category = "Vip" | "Pitchside" | "Standard" | "FansEnd";

export const CATEGORIES: Record<Category, { label: string; where: string; bps: bigint; weight: number; swatch: string; text: string }> = {
  Vip: { label: "VIP", where: "North Stand, rows 1 and 2", bps: 25_000n, weight: 10, swatch: "bg-[#b07a00]", text: "text-[#b07a00]" },
  Pitchside: { label: "Pitchside", where: "East and South Stands, rows 1 and 2", bps: 15_000n, weight: 6, swatch: "bg-[#c2607c]", text: "text-[#c2607c]" },
  Standard: { label: "Standard", where: "Rows 3 to 6 of the North, East and South Stands", bps: 10_000n, weight: 4, swatch: "bg-[#93868a]", text: "text-fg/80" },
  FansEnd: { label: "Fans' End", where: "West Stand, behind the goal", bps: 7_500n, weight: 3, swatch: "bg-[#3d7f89]", text: "text-[#3d7f89]" },
};
export const CATEGORY_ORDER: Category[] = ["Vip", "Pitchside", "Standard", "FansEnd"];

export function categoryOf(seat: string): Category {
  const stand = seat[0], row = Number(seat[1]);
  if (stand === "d") return "FansEnd";
  if (row <= 2) return stand === "a" ? "Vip" : "Pitchside";
  return "Standard";
}

/** Price of this seat, given the base (standard) price. */
export function priceFor(base: string | bigint, seat: string): bigint {
  return (BigInt(base) * CATEGORIES[categoryOf(seat)].bps) / 10_000n;
}

/** "2.5x" for VIP, "0.75x" for the fans' end. */
export function multiple(c: Category): string {
  return `${Number(CATEGORIES[c].bps) / 10_000}x`;
}
