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

    const rateResult = await client.callTool({
      name: "find_mortgage_product_rates",
      arguments: {
        loanAmount: 400_000,
        propertyValue: 500_000,
        depositAmount: 100_000,
      },
    });

    expect(rateResult.isError).not.toBe(true);
    expect(rateResult.structuredContent).toMatchObject({
      currency: "GBP",
      loanToValuePercent: 80,
      disclaimer: expect.stringContaining("Illustrative"),
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
