import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotal, formatMoney, type Service } from "./pricing.ts";

const services: Service[] = [
  { name: "Basic cleaning", base_price: 80 },
  { name: "Deep Cleaning", base_price: 50, unit_price: 2.5, unit_label: "m²" },
];

test("exact name match, base-only price", () => {
  const r = computeTotal(services, "Basic cleaning");
  assert.equal(r.service.name, "Basic cleaning");
  assert.equal(r.total, 80);
});

test("case-insensitive match with surrounding whitespace", () => {
  const r = computeTotal(services, "  deep cleaning ");
  assert.equal(r.service.name, "Deep Cleaning");
});

test("unknown service throws unknown_service", () => {
  assert.throws(() => computeTotal(services, "window washing"), /unknown_service/);
});

test("base + unit_price × quantity", () => {
  const r = computeTotal(services, "Deep Cleaning", 40);
  assert.equal(r.total, 50 + 2.5 * 40);
});

test("quantity defaults to 0", () => {
  const r = computeTotal(services, "Deep Cleaning");
  assert.equal(r.total, 50);
});

test("price override wins", () => {
  const r = computeTotal(services, "Deep Cleaning", 40, 123.45);
  assert.equal(r.total, 123.45);
});

test("negative or non-finite override is ignored", () => {
  assert.equal(computeTotal(services, "Basic cleaning", 0, -5).total, 80);
  assert.equal(computeTotal(services, "Basic cleaning", 0, NaN).total, 80);
});

test("total is rounded to 2 decimals", () => {
  const svc: Service[] = [{ name: "odd", base_price: 0.1, unit_price: 0.2 }];
  const r = computeTotal(svc, "odd", 1); // 0.1 + 0.2 = 0.30000000000000004
  assert.equal(r.total, 0.3);
});

test("formatMoney renders 2 decimals plus currency", () => {
  assert.equal(formatMoney(149.5, "USD"), "149.50 USD");
  assert.equal(formatMoney(80, "€"), "80.00 €");
});
