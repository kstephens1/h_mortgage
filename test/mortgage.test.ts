import { describe, expect, it } from "vitest";
import {
  calculateMortgageRepayment,
  findIllustrativeMortgageProducts,
} from "../src/mortgage.js";

describe("calculateMortgageRepayment", () => {
  it("calculates a standard UK repayment mortgage", () => {
    const result = calculateMortgageRepayment({
      loanAmount: 250_000,
      annualInterestRatePercent: 5,
      termYears: 25,
    });

    expect(result.currency).toBe("GBP");
    expect(result.termMonths).toBe(300);
    expect(result.monthlyPayment).toBe(1461.48);
    expect(result.totalPaid).toBe(438442.53);
    expect(result.totalInterest).toBe(188442.53);
    expect(result.overpaymentImpact).toBeUndefined();
  });

  it("handles zero percent interest", () => {
    const result = calculateMortgageRepayment({
      loanAmount: 120_000,
      annualInterestRatePercent: 0,
      termYears: 20,
    });

    expect(result.monthlyPayment).toBe(500);
    expect(result.totalPaid).toBe(120_000);
    expect(result.totalInterest).toBe(0);
  });

  it("calculates overpayment impact", () => {
    const baseline = calculateMortgageRepayment({
      loanAmount: 250_000,
      annualInterestRatePercent: 5,
      termYears: 25,
    });
    const overpaid = calculateMortgageRepayment({
      loanAmount: 250_000,
      annualInterestRatePercent: 5,
      termYears: 25,
      monthlyOverpayment: 200,
    });

    expect(overpaid.monthlyPaymentWithOverpayment).toBe(1661.48);
    expect(overpaid.overpaymentImpact).toBeDefined();
    expect(overpaid.overpaymentImpact?.payoffMonths).toBeLessThan(
      baseline.termMonths,
    );
    expect(overpaid.overpaymentImpact?.interestSaved).toBeGreaterThan(0);
  });

  it.each([
    [{ loanAmount: -1, annualInterestRatePercent: 5, termYears: 25 }],
    [{ loanAmount: 250_000, annualInterestRatePercent: -1, termYears: 25 }],
    [{ loanAmount: 250_000, annualInterestRatePercent: 5, termYears: 0 }],
    [
      {
        loanAmount: 250_000,
        annualInterestRatePercent: 5,
        termYears: 25,
        monthlyOverpayment: -1,
      },
    ],
  ])("rejects invalid input %#", (input) => {
    expect(() => calculateMortgageRepayment(input)).toThrow();
  });
});

describe("findIllustrativeMortgageProducts", () => {
  it("prices fixed and tracker products from LTV and mortgage term", () => {
    const result = findIllustrativeMortgageProducts({
      propertyValue: 500_000,
      loanAmount: 300_000,
      termYears: 25,
    });

    expect(result.loanToValuePercent).toBe(60);
    expect(result.maximumLoanToValuePercent).toBe(60);
    expect(result.depositAmount).toBe(200_000);
    expect(result.products).toHaveLength(8);
    expect(result.products.some((product) => product.rateType === "fixed")).toBe(true);
    expect(result.products.some((product) => product.rateType === "tracker")).toBe(true);
    expect(result.products[0]).toMatchObject({
      name: "2 Year Fixed Fee Saver",
      initialRatePercent: 4.69,
      productFee: 0,
      maximumLoanToValuePercent: 60,
    });
  });

  it("increases the illustrative rate at higher LTV bands", () => {
    const lowLtv = findIllustrativeMortgageProducts({
      propertyValue: 500_000,
      loanAmount: 300_000,
      termYears: 25,
    });
    const highLtv = findIllustrativeMortgageProducts({
      propertyValue: 500_000,
      loanAmount: 425_000,
      termYears: 25,
    });

    expect(highLtv.loanToValuePercent).toBe(85);
    expect(highLtv.products[0]?.initialRatePercent).toBeGreaterThan(
      lowLtv.products[0]?.initialRatePercent ?? 0,
    );
  });

  it("preserves the selected mortgage journey without changing the illustrative pricing algorithm", () => {
    const defaultJourney = findIllustrativeMortgageProducts({
      propertyValue: 500_000,
      loanAmount: 300_000,
      termYears: 25,
    });
    const firstTimeBuyer = findIllustrativeMortgageProducts({
      propertyValue: 500_000,
      loanAmount: 300_000,
      termYears: 25,
      mortgageNeed: "first_time_buyer",
    });

    expect(defaultJourney.mortgageNeed).toBe("switch_residential");
    expect(firstTimeBuyer.mortgageNeed).toBe("first_time_buyer");
    expect(firstTimeBuyer.products).toEqual(defaultJourney.products);
  });

  it.each([
    [{ propertyValue: 500_000, loanAmount: 500_000, termYears: 25 }],
    [{ propertyValue: 500_000, loanAmount: 455_000, termYears: 25 }],
    [{ propertyValue: 500_000, loanAmount: 300_000, termYears: 1 }],
  ])("rejects an unsupported product search %#", (input) => {
    expect(() => findIllustrativeMortgageProducts(input)).toThrow();
  });
});
