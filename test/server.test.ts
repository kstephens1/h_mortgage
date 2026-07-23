import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMortgageServer } from "../src/server.js";

describe("createMortgageServer", () => {
  it("exposes and calls mortgage tools over MCP", async () => {
    const client = new Client({ name: "mortgage-test-client", version: "0.1.0" });
    const server = createMortgageServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "calculate_mortgage_repayment",
    );
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "find_mortgage_product_rates",
    );
    expect(tools.tools.map((tool) => tool.name)).toContain(
      "get_customer_support",
    );

    const result = await client.callTool({
      name: "calculate_mortgage_repayment",
      arguments: {
        loanAmount: 250_000,
        annualInterestRatePercent: 5,
        termYears: 25,
        monthlyOverpayment: 200,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      currency: "GBP",
      monthlyPayment: 1461.48,
      monthlyOverpayment: 200,
      monthlyPaymentWithOverpayment: 1661.48,
    });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringMatching(
            /\*\*Loan amount:\*\* £250,000\.00[\s\S]*\*\*Total interest payable with overpayment:\*\*/,
          ),
        }),
      ]),
    );

    const rateResult = await client.callTool({
      name: "find_mortgage_product_rates",
      arguments: {
        loanAmount: 400_000,
        propertyValue: 500_000,
        depositAmount: 100_000,
        termYears: 25,
      },
    });

    expect(rateResult.isError).not.toBe(true);
    expect(rateResult.structuredContent).toMatchObject({
      currency: "GBP",
      loanToValuePercent: 80,
      maximumLoanToValuePercent: 80,
      termYears: 25,
      products: expect.arrayContaining([
        expect.objectContaining({ monthlyPayment: expect.any(Number) }),
      ]),
      mortgageNeed: "switch_residential",
      disclaimer: expect.stringContaining("Illustrative"),
    });

    const supportResult = await client.callTool({
      name: "get_customer_support",
      arguments: { topic: "mortgage" },
    });

    expect(supportResult.isError).not.toBe(true);
    expect(supportResult.structuredContent).toMatchObject({
      topic: "mortgage",
      contactPageUrl: "https://servicing.hsbc.co.uk/mortgages/guidance/",
      phoneLines: expect.arrayContaining([
        expect.objectContaining({ number: "0800 169 6333" }),
      ]),
      onlineOptions: expect.arrayContaining([
        expect.objectContaining({
          url: "https://www.hsbc.co.uk/ways-to-bank/online-banking/",
        }),
      ]),
    });

    const generalSupportResult = await client.callTool({
      name: "get_customer_support",
      arguments: {},
    });

    expect(generalSupportResult.isError).not.toBe(true);
    expect(generalSupportResult.structuredContent).toMatchObject({
      topic: "general",
      contactPageUrl: "https://www.hsbc.co.uk/contact/",
      phoneLines: expect.arrayContaining([
        expect.objectContaining({ number: "03457 404 404" }),
        expect.objectContaining({ number: "03457 707 070" }),
      ]),
      onlineOptions: expect.arrayContaining([
        expect.objectContaining({ url: "https://www.hsbc.co.uk/contact/" }),
        expect.objectContaining({
          url: "https://www.hsbc.co.uk/ways-to-bank/online-banking/",
        }),
      ]),
    });

    const invalidRateResult = await client.callTool({
      name: "find_mortgage_product_rates",
      arguments: {
        loanAmount: 400_000,
        propertyValue: 500_000,
        depositAmount: 90_000,
      },
    });
    expect(invalidRateResult.isError).toBe(true);

    await client.close();
    await server.close();
  });
});
