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

export type MortgageProductFinderInput = {
  loanAmount: number;
  propertyValue: number;
  termYears: number;
  depositAmount?: number;
  mortgageNeed?: MortgageNeed;
};

export const MORTGAGE_NEEDS = [
  "switch_residential",
  "first_time_buyer",
  "move_home",
  "remortgage",
  "buy_to_let",
  "remortgage_buy_to_let",
  "switch_buy_to_let",
] as const;

export type MortgageNeed = (typeof MORTGAGE_NEEDS)[number];

export type IllustrativeMortgageProduct = {
  id: string;
  name: string;
  rateType: "fixed" | "tracker";
  initialRatePercent: number;
  initialPeriodYears: number;
  productFee: number;
  maximumLoanToValuePercent: number;
  monthlyPayment: number;
  annualPercentageRatePercent: number;
  reversionRatePercent: number;
  features: string[];
};

export type MortgageProductFinderResult = {
  currency: "GBP";
  loanAmount: number;
  propertyValue: number;
  depositAmount: number;
  termYears: number;
  loanToValuePercent: number;
  maximumLoanToValuePercent: number;
  mortgageNeed: MortgageNeed;
  products: IllustrativeMortgageProduct[];
  disclaimer: string;
};

const PRODUCT_RATE_DISCLAIMER =
  "Illustrative local rates generated from this demo's LTV and term algorithm. They are not live HSBC rates, eligibility decisions, or a product offer.";

const LTV_BANDS = [
  { maximumLoanToValuePercent: 60, riskPremiumPercent: 0 },
  { maximumLoanToValuePercent: 75, riskPremiumPercent: 0.17 },
  { maximumLoanToValuePercent: 80, riskPremiumPercent: 0.31 },
  { maximumLoanToValuePercent: 85, riskPremiumPercent: 0.52 },
  { maximumLoanToValuePercent: 90, riskPremiumPercent: 0.78 },
] as const;

const PRODUCT_TEMPLATES = [
  { id: "two-year-fixed-fee-saver", name: "2 Year Fixed Fee Saver", rateType: "fixed" as const, initialPeriodYears: 2, baseRatePercent: 4.69, productFee: 0, features: ["Fee Saver", "Free standard valuation*"] },
  { id: "two-year-fixed-standard", name: "2 Year Fixed Standard", rateType: "fixed" as const, initialPeriodYears: 2, baseRatePercent: 4.43, productFee: 999, features: ["Free standard valuation*"] },
  { id: "two-year-tracker-standard", name: "2 Year Term Tracker Standard", rateType: "tracker" as const, initialPeriodYears: 2, baseRatePercent: 4.05, productFee: 999, features: ["Free standard valuation*"] },
  { id: "two-year-tracker-fee-saver", name: "2 Year Term Tracker Fee Saver", rateType: "tracker" as const, initialPeriodYears: 2, baseRatePercent: 4.99, productFee: 0, features: ["Fee Saver", "Free standard valuation*"] },
  { id: "three-year-fixed-fee-saver", name: "3 Year Fixed Fee Saver", rateType: "fixed" as const, initialPeriodYears: 3, baseRatePercent: 4.86, productFee: 0, features: ["Fee Saver", "Free standard valuation*"] },
  { id: "three-year-fixed-standard", name: "3 Year Fixed Standard", rateType: "fixed" as const, initialPeriodYears: 3, baseRatePercent: 4.61, productFee: 999, features: ["Free standard valuation*"] },
  { id: "five-year-fixed-fee-saver", name: "5 Year Fixed Fee Saver", rateType: "fixed" as const, initialPeriodYears: 5, baseRatePercent: 4.59, productFee: 0, features: ["Fee Saver", "Free standard valuation*"] },
  { id: "five-year-fixed-standard", name: "5 Year Fixed Standard", rateType: "fixed" as const, initialPeriodYears: 5, baseRatePercent: 4.49, productFee: 999, features: ["Free standard valuation*"] },
] as const;

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

export function findIllustrativeMortgageProducts(
  input: MortgageProductFinderInput,
): MortgageProductFinderResult {
  assertFinitePositive(input.loanAmount, "loanAmount");
  assertFinitePositive(input.propertyValue, "propertyValue");

  if (!Number.isInteger(input.termYears) || input.termYears < 2 || input.termYears > 40) {
    throw new Error("termYears must be a whole number from 2 to 40.");
  }

  if (input.loanAmount >= input.propertyValue) {
    throw new Error("loanAmount must be less than propertyValue.");
  }

  const mortgageNeed = input.mortgageNeed ?? "switch_residential";
  if (!MORTGAGE_NEEDS.includes(mortgageNeed)) {
    throw new Error("mortgageNeed must be a supported mortgage journey.");
  }

  const depositAmount = input.propertyValue - input.loanAmount;
  if (
    input.depositAmount !== undefined &&
    Math.abs(input.depositAmount - depositAmount) > 0.01
  ) {
    throw new Error("depositAmount must equal propertyValue minus loanAmount.");
  }

  const loanToValuePercent = (input.loanAmount / input.propertyValue) * 100;
  const ltvBand = LTV_BANDS.find(
    (band) => loanToValuePercent <= band.maximumLoanToValuePercent,
  );

  if (!ltvBand) {
    throw new Error("No illustrative products are available above 90% LTV.");
  }

  const reversionRatePercent = roundRate(6.24 + ltvBand.riskPremiumPercent / 2);
  const products = PRODUCT_TEMPLATES.map((template) => {
    const initialRatePercent = roundRate(
      template.baseRatePercent + ltvBand.riskPremiumPercent,
    );
    const monthlyPayment = calculateMonthlyPayment(
      input.loanAmount,
      initialRatePercent / 100 / 12,
      input.termYears * 12,
    );
    const annualPercentageRatePercent = estimateAprc(
      initialRatePercent,
      reversionRatePercent,
      template.initialPeriodYears,
      input.termYears,
      template.productFee,
      input.loanAmount,
    );

    return {
      id: template.id,
      name: template.name,
      rateType: template.rateType,
      initialRatePercent,
      initialPeriodYears: template.initialPeriodYears,
      productFee: template.productFee,
      maximumLoanToValuePercent: ltvBand.maximumLoanToValuePercent,
      monthlyPayment: roundMoney(monthlyPayment),
      annualPercentageRatePercent,
      reversionRatePercent,
      features: [...template.features],
    };
  });

  return {
    currency: "GBP",
    loanAmount: roundMoney(input.loanAmount),
    propertyValue: roundMoney(input.propertyValue),
    depositAmount: roundMoney(depositAmount),
    termYears: input.termYears,
    loanToValuePercent: roundRate(loanToValuePercent),
    maximumLoanToValuePercent: ltvBand.maximumLoanToValuePercent,
    mortgageNeed,
    products,
    disclaimer: PRODUCT_RATE_DISCLAIMER,
  };
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

function roundRate(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function estimateAprc(
  initialRatePercent: number,
  reversionRatePercent: number,
  initialPeriodYears: number,
  termYears: number,
  productFee: number,
  loanAmount: number,
): number {
  const initialMonths = Math.min(initialPeriodYears * 12, termYears * 12);
  const weightedRate =
    (initialRatePercent * initialMonths +
      reversionRatePercent * (termYears * 12 - initialMonths)) /
    (termYears * 12);
  const feeRateAdjustment = (productFee / loanAmount) * 100 * 1.3;
  return roundRate(weightedRate + feeRateAdjustment);
}
