export const MORTGAGE_DISCLAIMER =
  "This is an estimate for illustration only and is not financial advice.";

export type MortgageCalculationInput = {
  loanAmount: number;
  annualInterestRatePercent: number;
  termYears: number;
  monthlyOverpayment?: number;
};

export type OverpaymentImpact = {
  payoffMonths: number;
  timeSavedMonths: number;
  interestSaved: number;
  totalPaidWithOverpayment: number;
  totalInterestWithOverpayment: number;
};

export type MortgageCalculationResult = {
  currency: "GBP";
  loanAmount: number;
  annualInterestRatePercent: number;
  termYears: number;
  termMonths: number;
  monthlyPayment: number;
  monthlyOverpayment: number;
  monthlyPaymentWithOverpayment: number;
  totalPaid: number;
  totalInterest: number;
  overpaymentImpact?: OverpaymentImpact;
  disclaimer: string;
};

type AmortizationSummary = {
  payoffMonths: number;
  totalPaid: number;
  totalInterest: number;
};

export function calculateMortgageRepayment(
  input: MortgageCalculationInput,
): MortgageCalculationResult {
  assertValidInput(input);

  const termMonths = input.termYears * 12;
  const monthlyRate = input.annualInterestRatePercent / 100 / 12;
  const monthlyOverpayment = input.monthlyOverpayment ?? 0;
  const monthlyPayment = calculateMonthlyPayment(
    input.loanAmount,
    monthlyRate,
    termMonths,
  );
  const baseline = amortizeLoan(input.loanAmount, monthlyRate, monthlyPayment);

  const result: MortgageCalculationResult = {
    currency: "GBP",
    loanAmount: roundMoney(input.loanAmount),
    annualInterestRatePercent: input.annualInterestRatePercent,
    termYears: input.termYears,
    termMonths,
    monthlyPayment: roundMoney(monthlyPayment),
    monthlyOverpayment: roundMoney(monthlyOverpayment),
    monthlyPaymentWithOverpayment: roundMoney(monthlyPayment + monthlyOverpayment),
    totalPaid: roundMoney(baseline.totalPaid),
    totalInterest: roundMoney(baseline.totalInterest),
    disclaimer: MORTGAGE_DISCLAIMER,
  };

  if (monthlyOverpayment > 0) {
    const withOverpayment = amortizeLoan(
      input.loanAmount,
      monthlyRate,
      monthlyPayment + monthlyOverpayment,
    );

    result.overpaymentImpact = {
      payoffMonths: withOverpayment.payoffMonths,
      timeSavedMonths: Math.max(0, termMonths - withOverpayment.payoffMonths),
      interestSaved: roundMoney(
        Math.max(0, baseline.totalInterest - withOverpayment.totalInterest),
      ),
      totalPaidWithOverpayment: roundMoney(withOverpayment.totalPaid),
      totalInterestWithOverpayment: roundMoney(withOverpayment.totalInterest),
    };
  }

  return result;
}

function calculateMonthlyPayment(
  principal: number,
  monthlyRate: number,
  termMonths: number,
): number {
  if (monthlyRate === 0) {
    return principal / termMonths;
  }

  const growth = (1 + monthlyRate) ** termMonths;
  return (principal * monthlyRate * growth) / (growth - 1);
}

function amortizeLoan(
  principal: number,
  monthlyRate: number,
  monthlyPayment: number,
): AmortizationSummary {
  let balance = principal;
  let totalPaid = 0;
  let totalInterest = 0;
  let payoffMonths = 0;
  const maxMonths = 1_200;

  while (balance > 0.005 && payoffMonths < maxMonths) {
    const interest = balance * monthlyRate;
    const principalPayment = monthlyPayment - interest;

    if (principalPayment <= 0) {
      throw new Error("Monthly payment is too low to reduce the loan balance.");
    }

    const payment = Math.min(monthlyPayment, balance + interest);
    balance = Math.max(0, balance + interest - payment);
    totalPaid += payment;
    totalInterest += interest;
    payoffMonths += 1;
  }

  if (payoffMonths >= maxMonths) {
    throw new Error("Mortgage calculation did not converge.");
  }

  return { payoffMonths, totalPaid, totalInterest };
}

function assertValidInput(input: MortgageCalculationInput): void {
  assertFinitePositive(input.loanAmount, "loanAmount");
  assertFiniteNonNegative(
    input.annualInterestRatePercent,
    "annualInterestRatePercent",
  );

  if (
    !Number.isInteger(input.termYears) ||
    !Number.isFinite(input.termYears) ||
    input.termYears <= 0
  ) {
    throw new Error("termYears must be a positive integer.");
  }

  if (input.monthlyOverpayment !== undefined) {
    assertFiniteNonNegative(input.monthlyOverpayment, "monthlyOverpayment");
  }
}

function assertFinitePositive(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive finite number.`);
  }
}

function assertFiniteNonNegative(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number.`);
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
