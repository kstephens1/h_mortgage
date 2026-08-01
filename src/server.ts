import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  calculateMortgageRepayment,
  findIllustrativeMortgageProducts,
  MORTGAGE_NEEDS,
  type MortgageCalculationResult,
} from "./mortgage.js";

const MCP_PATH = "/mcp";
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ??
    "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

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
    .optional()
    .describe("Deposit or equity contribution in pounds sterling."),
  termYears: z
    .number()
    .int()
    .min(2)
    .max(40)
    .default(25)
    .describe("Mortgage term in whole years. Defaults to 25 for compatibility."),
  mortgageNeed: z
    .enum(MORTGAGE_NEEDS)
    .default("switch_residential")
    .describe("Mortgage journey context. Uses the same illustrative rate algorithm for every journey."),
};

const productRateOutputSchema = {
  currency: z.literal("GBP"),
  loanAmount: z.number().positive(),
  propertyValue: z.number().positive(),
  depositAmount: z.number().positive(),
  termYears: z.number().int().min(2).max(40),
  loanToValuePercent: z.number().positive(),
  maximumLoanToValuePercent: z.number().positive(),
  mortgageNeed: z.enum(MORTGAGE_NEEDS),
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      rateType: z.enum(["fixed", "tracker"]),
      initialRatePercent: z.number().positive(),
      initialPeriodYears: z.number().int().positive(),
      productFee: z.number().nonnegative(),
      maximumLoanToValuePercent: z.number().positive(),
      monthlyPayment: z.number().positive(),
      annualPercentageRatePercent: z.number().positive(),
      reversionRatePercent: z.number().positive(),
      features: z.array(z.string()),
    }),
  ),
  disclaimer: z.string(),
};

const customerSupportInputSchema = {
  topic: z
    .enum(["general", "mortgage"])
    .default("general")
    .describe("Use mortgage for a mortgage-specific support request; otherwise use general."),
};

const customerSupportOutputSchema = {
  topic: z.enum(["general", "mortgage"]),
  contactPageUrl: z.string().url(),
  contactPageLabel: z.string(),
  phoneLines: z.array(
    z.object({
      label: z.string(),
      number: z.string(),
      openingHours: z.string(),
    }),
  ),
  onlineOptions: z.array(
    z.object({
      label: z.string(),
      url: z.string().url(),
      instructions: z.string(),
    }),
  ),
  disclaimer: z.string(),
};

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
        "Generates illustrative local fixed and tracker mortgage products from the loan-to-value and mortgage term. Returns monthly repayments, product fees, initial rates, estimated APRC, and reversion rates. This is not a live product feed or an eligibility assessment.",
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
      try {
        const result = findIllustrativeMortgageProducts(args);

        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `${result.products.length} illustrative products generated for ${result.loanToValuePercent}% LTV over ${result.termYears} years. ${result.disclaimer}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    },
  );

  server.registerTool(
    "get_customer_support",
    {
      title: "Get HSBC customer support contact options",
      description:
        "Returns local, official-source-linked HSBC UK general or mortgage customer-support contact options. Use this when the customer asks for help or asks how to contact HSBC. Contact details are a snapshot; the linked official page is the source of truth.",
      inputSchema: customerSupportInputSchema,
      outputSchema: customerSupportOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ topic }) => {
      const result = getCustomerSupport(topic);
      return {
        structuredContent: result,
        content: [{ type: "text", text: formatCustomerSupportResult(result) }],
      };
    },
  );

  return server;
}

function getCustomerSupport(topic: "general" | "mortgage") {
  if (topic === "mortgage") {
    return {
      topic,
      contactPageUrl: "https://servicing.hsbc.co.uk/mortgages/guidance/",
      contactPageLabel: "HSBC mortgage support",
      phoneLines: [
        {
          label: "Mortgage support (UK)",
          number: "0800 169 6333",
          openingHours: "Monday to Friday 08:00–20:00; Saturday and Sunday 09:00–17:00 (UK time).",
        },
      ],
      onlineOptions: [
        {
          label: "HSBC Contact and online chat",
          url: "https://www.hsbc.co.uk/contact/",
          instructions: "See HSBC's contact options and instructions for starting chat in online or mobile banking.",
        },
        {
          label: "HSBC Online Banking",
          url: "https://www.hsbc.co.uk/ways-to-bank/online-banking/",
          instructions: "Log on, then select Chat on the right-hand side of online banking.",
        },
      ],
      disclaimer: "Contact details are an official-source snapshot. Check the linked HSBC page for the latest options and opening hours.",
    };
  }

  return {
    topic,
    contactPageUrl: "https://www.hsbc.co.uk/contact/",
    contactPageLabel: "HSBC Contact us",
    phoneLines: [
      {
        label: "Existing customers (UK)",
        number: "03457 404 404",
        openingHours: "08:00–20:00 every day.",
      },
      {
        label: "Existing customers (outside the UK)",
        number: "+44 1226 261 010",
        openingHours: "08:00–20:00 every day (UK time).",
      },
      {
        label: "Non-HSBC customers (UK)",
        number: "03455 873 444",
        openingHours: "See the official contact page for current opening hours.",
      },
      {
        label: "Existing Premier customers (UK)",
        number: "03457 707 070",
        openingHours: "Open 24 hours a day, 7 days a week.",
      },
      {
        label: "Existing Premier customers (outside the UK)",
        number: "+44 1226 260 260",
        openingHours: "Open 24 hours a day, 7 days a week.",
      },
    ],
    onlineOptions: [
      {
        label: "HSBC Contact and online chat",
        url: "https://www.hsbc.co.uk/contact/",
        instructions: "See HSBC's contact options and instructions for starting chat in online or mobile banking.",
      },
      {
        label: "HSBC Online Banking",
        url: "https://www.hsbc.co.uk/ways-to-bank/online-banking/",
        instructions: "Log on, then select Chat on the right-hand side of online banking.",
      },
    ],
    disclaimer: "Contact details are an official-source snapshot. Check the linked HSBC page for the latest options and opening hours.",
  };
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
      writeCorsHeaders(req.headers.origin, res);
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
      writeCorsHeaders(req.headers.origin, res);

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

function writeCorsHeaders(origin: string | undefined, res: ServerResponse): void {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization, content-type, mcp-protocol-version, mcp-session-id",
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function formatMortgageResult(result: MortgageCalculationResult): string {
  const lines = [
    "## Repayment estimate",
    "",
    `- **Loan amount:** ${formatPounds(result.loanAmount)}`,
    `- **Annual interest rate:** ${result.annualInterestRatePercent.toFixed(2)}%`,
    `- **Term:** ${result.termYears} years`,
    `- **Monthly overpayment:** ${formatPounds(result.monthlyOverpayment)}`,
    `- **Standard monthly repayment:** ${formatPounds(result.monthlyPayment)}`,
    `- **Standard total interest payable:** ${formatPounds(result.totalInterest)}`,
  ];

  if (result.overpaymentImpact) {
    lines.push(
      `- **Monthly payment including overpayment:** ${formatPounds(result.monthlyPaymentWithOverpayment)}`,
      `- **Total interest payable with overpayment:** ${formatPounds(result.overpaymentImpact.totalInterestWithOverpayment)}`,
      `- **Interest saved:** ${formatPounds(result.overpaymentImpact.interestSaved)}`,
      `- **Time saved:** ${result.overpaymentImpact.timeSavedMonths} months`,
    );
  }

  lines.push("", result.disclaimer);
  return lines.join("\n");
}

function formatCustomerSupportResult(result: ReturnType<typeof getCustomerSupport>): string {
  const lines = [
    `## ${result.contactPageLabel}`,
    ...result.phoneLines.map(
      (line) => `- **${line.label}:** ${line.number} — ${line.openingHours}`,
    ),
    "",
    "### Chat and online contact",
    ...result.onlineOptions.map(
      (option) => `- [${option.label}](${option.url}) — ${option.instructions}`,
    ),
    "",
    result.disclaimer,
  ];
  return lines.join("\n");
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
