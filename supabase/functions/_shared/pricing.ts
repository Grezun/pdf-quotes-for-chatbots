export type Service = {
  name: string;
  base_price: number;
  unit_price?: number;
  unit_label?: string;
};

export function computeTotal(
  services: Service[],
  serviceName: string,
  quantity?: number,
  priceOverride?: number,
): { service: Service; total: number } {
  const wanted = serviceName.trim().toLowerCase();
  const service = services.find((s) => s.name.trim().toLowerCase() === wanted);
  if (!service) throw new Error("unknown_service");

  let total = service.base_price + (service.unit_price ?? 0) * (quantity ?? 0);
  if (typeof priceOverride === "number" && Number.isFinite(priceOverride) && priceOverride >= 0) {
    total = priceOverride;
  }
  return { service, total: Math.round(total * 100) / 100 };
}

export function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}
