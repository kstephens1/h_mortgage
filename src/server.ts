import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  calculateMortgageRepayment,
  type MortgageCalculationResult,
} from "./mortgage.js";

const MCP_PATH = "/mcp";

const mortgageInputSchema = {
  loanAmount: z
    .number()
    .positive()
    .describe("Mortgage loan amount in pounds sterling."),
  annualInterestRatePercent: z
    .number()
    .min(0)
    .describe("Nominal annual interest rate as a percentage, for example 5.25."),
  termYears: z
    .number()
    .int()
    .positive()
    .describe("Mortgage term in whole years."),
  monthlyOverpayment: z
    .number()
    .min(0)
    .optional()
    .describe("Optional extra amount paid each month in pounds sterling."),
};

const overpaymentImpactSchema = z.object({
  payoffMonths: z.number().int().nonnegative(),
  timeSavedMonths: z.number().int().nonnegative(),
  interestSaved: z.number().nonnegative(),
  totalPaidWithOverpayment: z.number().nonnegative(),
  totalInterestWithOverpayment: z.number().nonnegative(),
});

const mortgageOutputSchema = {
  currency: z.literal("GBP"),
  loanAmount: z.number().positive(),
  annualInterestRatePercent: z.number().min(0),
  termYears: z.number().int().positive(),
  termMonths: z.number().int().positive(),
  monthlyPayment: z.number().nonnegative(),
  monthlyOverpayment: z.number().nonnegative(),
  monthlyPaymentWithOverpayment: z.number().nonnegative(),
  totalPaid: z.number().nonnegative(),
  totalInterest: z.number().nonnegative(),
  overpaymentImpact: overpaymentImpactSchema.optional(),
  disclaimer: z.string(),
};

const productRateInputSchema = {
  loanAmount: z
    .number()
    .positive()
    .describe("Mortgage loan amount in pounds sterling."),
  propertyValue: z
    .number()
    .positive()
    .describe("Property purchase price or current property value in pounds sterling."),
  depositAmount: z
    .number()
    .positive()
    .describe("Deposit or equity contribution in pounds sterling."),
};

const productRateOutputSchema = {
  currency: z.literal("GBP"),
  loanAmount: z.number().positive(),
  propertyValue: z.number().positive(),
  depositAmount: z.number().positive(),
  loanToValuePercent: z.number().positive(),
  products: z.array(
    z.object({
      name: z.string(),
      initialRatePercent: z.number().positive(),
      fixedPeriodYears: z.number().int().positive(),
      productFee: z.number().nonnegative(),
      maximumLoanToValuePercent: z.number().positive(),
    }),
  ),
  disclaimer: z.string(),
};

const productRateFixtures = [
  {
    name: "HSBC-style 2 Year Fixed - 90% LTV",
    initialRatePercent: 5.79,
    fixedPeriodYears: 2,
    productFee: 999,
    maximumLoanToValuePercent: 90,
  },
  {
    name: "HSBC-style 5 Year Fixed - 90% LTV",
    initialRatePercent: 5.49,
    fixedPeriodYears: 5,
    productFee: 999,
    maximumLoanToValuePercent: 90,
  },
  {
    name: "HSBC-style 2 Year Fixed - 80% LTV",
    initialRatePercent: 5.19,
    fixedPeriodYears: 2,
    productFee: 999,
    maximumLoanToValuePercent: 80,
  },
  {
    name: "HSBC-style 5 Year Fixed - 60% LTV",
    initialRatePercent: 4.89,
    fixedPeriodYears: 5,
    productFee: 999,
    maximumLoanToValuePercent: 60,
  },
];

const PRODUCT_RATE_DISCLAIMER =
  "Illustrative local fixture rates only. They are not live HSBC rates, eligibility decisions, or a product offer.";

export function createMortgageServer(): McpServer {
  const server = new McpServer({
    name: "uk-mortgage-tools",
    version: "0.1.0",
  });

  server.registerTool(
    "calculate_mortgage_repayment",
    {
      title: "Calculate mortgage repayment",
      description:
        "Calculates estimated monthly payments, total paid, total interest, and optional overpayment impact for a UK repayment mortgage.",
      inputSchema: mortgageInputSchema,
      outputSchema: mortgageOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      const result = calculateMortgageRepayment(args);

      return {
        structuredContent: result,
        content: [{ type: "text", text: formatMortgageResult(result) }],
      };
    },
  );

  server.registerTool(
    "find_mortgage_product_rates",
    {
      title: "Find illustrative mortgage product rates",
      description:
        "Returns illustrative local mortgage product-rate fixtures matched by loan-to-value. This is not a live product feed or an eligibility assessment.",
      inputSchema: productRateInputSchema,
      outputSchema: productRateOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async (args) => {
      if (Math.abs(args.loanAmount + args.depositAmount - args.propertyValue) > 0.01) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "loanAmount plus depositAmount must equal propertyValue.",
            },
          ],
        };
      }

      const loanToValuePercent = (args.loanAmount / args.propertyValue) * 100;
      const products = productRateFixtures.filter(
        (product) => loanToValuePercent <= product.maximumLoanToValuePercent,
      );

      if (products.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "No illustrative fixture products are available above 90% LTV.",
            },
          ],
        };
      }

      const result = {
        currency: "GBP" as const,
        ...args,
        loanToValuePercent: Number(loanToValuePercent.toFixed(2)),
        products,
        disclaimer: PRODUCT_RATE_DISCLAIMER,
      };

      return {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: `${products.map((product) => `${product.name}: ${product.initialRatePercent}% for ${product.fixedPeriodYears} years, fee ${formatPounds(product.productFee)}.`).join(" ")} ${PRODUCT_RATE_DISCLAIMER}`,
          },
        ],
      };
    },
  );

  return server;
}

export function startHttpServer(
  port = Number(process.env.PORT ?? 8787),
  host = process.env.HOST ?? "127.0.0.1",
): void {
  const httpServer = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end("Missing URL");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
      writeCorsHeaders(res);
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      res
        .writeHead(200, { "content-type": "text/plain" })
        .end("UK mortgage MCP server");
      return;
    }

    const mcpMethods = new Set(["POST", "GET", "DELETE"]);
    if (url.pathname === MCP_PATH && req.method && mcpMethods.has(req.method)) {
      writeCorsHeaders(res);

      const server = createMortgageServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.writeHead(500).end("Internal server error");
        }
      }

      return;
    }

    res.writeHead(404).end("Not Found");
  });

  httpServer.listen(port, host, () => {
    console.log(
      `UK mortgage MCP server listening on http://${host}:${port}${MCP_PATH}`,
    );
  });
}

function writeCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function formatMortgageResult(result: MortgageCalculationResult): string {
  const lines = [
    `Estimated monthly payment: ${formatPounds(result.monthlyPayment)}.`,
    `Total paid over ${result.termYears} years: ${formatPounds(result.totalPaid)}.`,
    `Total interest: ${formatPounds(result.totalInterest)}.`,
  ];

  if (result.overpaymentImpact) {
    lines.push(
      `With a ${formatPounds(result.monthlyOverpayment)} monthly overpayment, the estimated payoff is ${result.overpaymentImpact.payoffMonths} months, saving ${result.overpaymentImpact.timeSavedMonths} months and ${formatPounds(result.overpaymentImpact.interestSaved)} interest.`,
    );
  }

  lines.push(result.disclaimer);
  return lines.join(" ");
}

function formatPounds(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startHttpServer();
}
