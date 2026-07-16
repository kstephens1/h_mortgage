import { describe, expect, it } from "vitest";
import { calculateMortgageRepayment } from "../src/mortgage.js";

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
