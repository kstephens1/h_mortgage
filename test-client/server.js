import { createServer } from "node:http";

const HOST = process.env.TEST_CLIENT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TEST_CLIENT_API_PORT ?? 5174);
const DEFAULT_MCP_ENDPOINT = process.env.MCP_ENDPOINT ?? "http://127.0.0.1:8787/mcp";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "xiaomi/mimo-v2-flash";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MAX_TOKENS = parsePositiveInteger(
  process.env.OPENROUTER_MAX_TOKENS,
  2048,
  "OPENROUTER_MAX_TOKENS",
);
const ALLOWED_MCP_TOOLS = parseToolAllowlist(
  process.env.MCP_ALLOWED_TOOLS,
  ["calculate_mortgage_repayment", "find_mortgage_product_rates", "get_customer_support"],
);
const MAX_TOOL_LOOPS = 4;
const MORTGAGE_NEED_OPTIONS = [
  { id: "switch_residential", label: "Switch to a new residential deal" },
  { id: "first_time_buyer", label: "Buy my first home" },
  { id: "move_home", label: "Move home" },
  { id: "remortgage", label: "Remortgage from another provider" },
  { id: "buy_to_let", label: "Buy a rental property" },
  { id: "remortgage_buy_to_let", label: "Remortgage my buy-to-let" },
  { id: "switch_buy_to_let", label: "Switch to a new buy-to-let deal" },
];

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? HOST}`);

    if (req.method === "OPTIONS") {
      writeJson(res, 204, null);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        model: OPENROUTER_MODEL,
        maxTokens: OPENROUTER_MAX_TOKENS,
        mcpEndpoint: DEFAULT_MCP_ENDPOINT,
        allowedTools: ALLOWED_MCP_TOOLS,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/chat") {
      const body = await readJson(req);
      const result = await runChat(body);
      writeJson(res, 200, result);
      return;
    }

    writeJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { error: message });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => {
    console.log(
      `ChatHSBC orchestrator listening on http://${HOST}:${PORT} using ${OPENROUTER_MODEL}`,
    );
  });
}

async function runChat(body) {
  const messages = normalizeMessages(body?.messages);
  const hsbcMode = body?.hsbcMode === true;
  const mortgageNeed = normalizeMortgageNeed(body?.mortgageNeed);
  const mcpEndpoint = normalizeEndpoint(body?.mcpEndpoint);
  const activeMortgageWorkflow = hsbcMode
    ? getActiveMortgageWorkflow(messages, mortgageNeed)
    : null;

  if (hsbcMode && isCapabilityHelpRequest(messages)) {
    return {
      reply: buildHsbcCapabilityResponse(),
      model: OPENROUTER_MODEL,
      toolResults: [],
      source: "hsbc-guidance",
    };
  }

  if (hsbcMode && isCustomerSupportRequest(messages)) {
    const topic = isMortgageSpecificSupportRequest(messages) ? "mortgage" : "general";
    const result = await callMcpTool(mcpEndpoint, "get_customer_support", { topic });
    const reply = result.content?.find((item) => item.type === "text")?.text ??
      "I could not load HSBC customer-support contact details.";
    return {
      reply,
      model: OPENROUTER_MODEL,
      toolResults: [{ name: "get_customer_support", arguments: { topic }, result }],
      source: "mcp",
    };
  }

  if (hsbcMode && isDecisionInPrincipleRequest(messages)) {
    return {
      reply: "You can start an HSBC decision in principle online.",
      model: OPENROUTER_MODEL,
      toolResults: [],
      source: "hsbc-guidance",
      action: {
        label: "Get a decision in principle",
        url: "https://www.hsbc.co.uk/mortgages/decision-in-principle/",
      },
    };
  }

  if (hsbcMode && isMortgageDealFinderRequest(messages)) {
    return {
      reply: "What are you looking to do? Choose a mortgage journey to find illustrative deals.",
      model: OPENROUTER_MODEL,
      toolResults: [],
      source: "hsbc-guidance",
      actions: MORTGAGE_NEED_OPTIONS.map((option) => ({ kind: "mortgage-need", ...option })),
    };
  }

  if (hsbcMode && activeMortgageWorkflow === "repayment") {
    const repaymentMessages = getActiveWorkflowMessages(messages, "repayment");
    const repaymentDetails = extractRepaymentDetails(repaymentMessages);
    const missingFields = [];
    if (repaymentDetails.loanAmount === undefined) missingFields.push("**Loan amount**");
    if (repaymentDetails.annualInterestRatePercent === undefined) {
      missingFields.push("**Annual interest rate (%)**");
    }
    if (repaymentDetails.termYears === undefined) missingFields.push("**Term (years)**");

    if (missingFields.length > 0) {
      return {
        reply: buildMissingRepaymentDetailsResponse(missingFields),
        model: OPENROUTER_MODEL,
        toolResults: [],
        source: "hsbc-guidance",
      };
    }

    const arguments_ = {
      loanAmount: repaymentDetails.loanAmount,
      annualInterestRatePercent: repaymentDetails.annualInterestRatePercent,
      termYears: repaymentDetails.termYears,
      monthlyOverpayment: repaymentDetails.monthlyOverpayment ?? 0,
    };
    const result = await callMcpTool(mcpEndpoint, "calculate_mortgage_repayment", arguments_);
    const toolText = result.content?.find((item) => item.type === "text")?.text;
    return {
      reply: toolText ?? "I could not calculate a repayment estimate from those figures.",
      model: OPENROUTER_MODEL,
      toolResults: [{ name: "calculate_mortgage_repayment", arguments: arguments_, result }],
      source: "mcp",
    };
  }

  if (hsbcMode && shouldUseHsbcCapabilityResponse(messages)) {
    return {
      reply: buildHsbcCapabilityResponse(),
      model: OPENROUTER_MODEL,
      toolResults: [],
      source: "hsbc-guidance",
    };
  }

  const mortgageDetails = hsbcMode && mortgageNeed && activeMortgageWorkflow === "deals"
    ? extractMortgageDetails(getActiveWorkflowMessages(messages, "deals"))
    : null;
  if (mortgageDetails?.propertyValue && mortgageDetails.loanAmount) {
    const arguments_ = {
      loanAmount: mortgageDetails.loanAmount,
      propertyValue: mortgageDetails.propertyValue,
      termYears: mortgageDetails.termYears ?? 25,
      mortgageNeed,
      ...(mortgageDetails.depositAmount !== undefined
        ? { depositAmount: mortgageDetails.depositAmount }
        : {}),
    };
    const result = await callMcpTool(mcpEndpoint, "find_mortgage_product_rates", arguments_);
    const toolText = result.content?.find((item) => item.type === "text")?.text;
    return {
      reply: result.isError
        ? toolText ?? "I could not generate illustrative deals from those figures."
        : "Here are the illustrative mortgage deals matching the figures you provided.",
      model: OPENROUTER_MODEL,
      toolResults: [{ name: "find_mortgage_product_rates", arguments: arguments_, result }],
      source: "mcp",
    };
  }

  const token = getOpenRouterToken();
  if (!token) {
    throw new Error(
      "Missing OpenRouter API key. Set OPENROUTER_API_KEY in test-client/.env before starting the test client.",
    );
  }

  const availableTools = hsbcMode ? await discoverAllowedTools(mcpEndpoint) : [];
  const input = [
    { role: "system", content: buildSystemInstructions(availableTools, hsbcMode, mortgageNeed) },
    ...messages,
  ];
  const toolResults = [];

  for (let i = 0; i < MAX_TOOL_LOOPS; i += 1) {
    let response = await createChatCompletion(token, input, availableTools);
    let assistantMessage = response.choices?.[0]?.message;
    if (!assistantMessage) {
      response = await createChatCompletion(token, input, availableTools);
      assistantMessage = response.choices?.[0]?.message;
    }
    if (!assistantMessage) {
      throw new Error(describeIncompleteOpenRouterResponse(response));
    }
    const functionCalls = assistantMessage.tool_calls ?? [];

    if (functionCalls.length === 0) {
      return {
        reply: String(assistantMessage.content ?? "").trim() || "No response text returned.",
        model: OPENROUTER_MODEL,
        toolResults,
        responseId: response.id,
        source: toolResults.length > 0 ? "mcp" : hsbcMode ? "hsbc-guidance" : "generic",
      };
    }

    input.push({
      role: "assistant",
      content: assistantMessage.content,
      tool_calls: functionCalls,
    });

    for (const functionCall of functionCalls) {
      const toolName = functionCall.function?.name;
      if (functionCall.type !== "function" || !toolName || !availableTools.some((tool) => tool.name === toolName)) {
        throw new Error(`Unsupported tool call: ${functionCall.function?.name ?? "unknown"}`);
      }

      const argumentsJson = functionCall.function.arguments || "{}";
      const args = JSON.parse(argumentsJson);
      if (toolName === "find_mortgage_product_rates" && mortgageNeed && !args.mortgageNeed) {
        args.mortgageNeed = mortgageNeed;
      }
      const result = await callMcpTool(mcpEndpoint, toolName, args);
      toolResults.push({ name: toolName, arguments: args, result });
      input.push({
        role: "tool",
        tool_call_id: functionCall.id,
        content: JSON.stringify({
          text: result.content?.find((item) => item.type === "text")?.text,
          structuredContent: result.structuredContent,
          isError: result.isError === true,
        }),
      });
    }
  }

  throw new Error("The model requested too many tool calls.");
}

async function createChatCompletion(token, messages, availableTools) {
  const firstAttempt = await requestChatCompletion(
    token,
    messages,
    availableTools,
    OPENROUTER_MAX_TOKENS,
  );
  if (firstAttempt.response.ok) return firstAttempt.body;

  const errorMessage = firstAttempt.body.error?.message ??
    `OpenRouter request failed with ${firstAttempt.response.status}`;
  const affordableTokens = parseAffordableTokenLimit(errorMessage);
  if (affordableTokens !== null && affordableTokens < OPENROUTER_MAX_TOKENS) {
    const retryMaxTokens = Math.max(1, Math.floor(affordableTokens * 0.9));
    const retryAttempt = await requestChatCompletion(
      token,
      messages,
      availableTools,
      retryMaxTokens,
    );
    if (retryAttempt.response.ok) return retryAttempt.body;
    throw new Error(
      retryAttempt.body.error?.message ??
        `OpenRouter retry failed with ${retryAttempt.response.status}`,
    );
  }

  throw new Error(errorMessage);
}

async function requestChatCompletion(token, messages, availableTools, maxTokens) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-openrouter-title": "ChatHSBC Test Client",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: maxTokens,
      messages,
      ...(availableTools.length > 0 ? { tools: availableTools.map(toOpenRouterTool) } : {}),
    }),
  });

  const body = await response.json().catch(async () => ({
    error: { message: await response.text() },
  }));

  return { response, body };
}

function parseAffordableTokenLimit(message) {
  const match = String(message).match(/can only afford\s+([\d,]+)\b/i);
  if (!match) return null;
  const limit = Number(match[1].replaceAll(",", ""));
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

async function callMcpTool(mcpEndpoint, toolName, args) {
  return callMcpMethod(mcpEndpoint, "tools/call", {
    name: toolName,
    arguments: args,
  });
}

async function callMcpMethod(mcpEndpoint, method, params) {
  const response = await fetch(mcpEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const message = await readMcpResponse(response);
  if (message.error) {
    throw new Error(`${message.error.message} (${message.error.code})`);
  }

  return message.result;
}

async function discoverAllowedTools(mcpEndpoint) {
  const toolsResult = await callMcpMethod(mcpEndpoint, "tools/list", {});
  return (toolsResult.tools ?? []).filter(
    (tool) => ALLOWED_MCP_TOOLS.includes(tool.name) && isToolDefinition(tool),
  );
}

function toOpenRouterTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? tool.title ?? `MCP tool ${tool.name}.`,
      parameters: tool.inputSchema,
    },
  };
}

function buildSystemInstructions(availableTools, hsbcMode, mortgageNeed) {
  const toolSummary = availableTools.length
    ? availableTools.map((tool) => `- ${tool.name}: ${tool.description ?? tool.title ?? "No description provided."}`).join("\n")
    : "- No approved MCP tools are currently available.";

  if (!hsbcMode) {
    return `
You are a helpful, general-purpose AI assistant.
Answer the user's request directly and naturally. Do not focus on mortgages, HSBC, MCP tools, financial disclaimers, or this application's implementation unless the user asks about them.
No external tools are available in this mode.
Use concise GitHub-flavoured Markdown when formatting improves clarity. Do not use raw HTML.
`;
  }

  return `
You are an HSBC Mortgages assistant for testing local MCP tools.
HSBC Mortgages mode is active. Restrict every response to the available HSBC MCP capabilities below.
For a request covered by a tool, call that tool. If its required inputs are missing, ask only for the missing inputs.
For a mortgage request not covered by a tool, use a short, helpful capability response based only on the list below. Explain which supported actions are available and that there is no available MCP tool for the requested action.
For customer-support/contact requests, call get_customer_support. Use topic mortgage when the request is mortgage-specific; otherwise use general.
For non-mortgage requests, explain that HSBC Mortgages mode is limited to the listed MCP capabilities.
Never provide general mortgage guidance, live rates, product availability, eligibility decisions, HSBC policy, customer-service contact details, or facts not returned by a tool.
${mortgageNeed ? `The customer selected mortgage journey \`${mortgageNeed}\`. Preserve it when calling find_mortgage_product_rates.` : ""}
When a tool result is available, explain it in plain English and retain its disclaimers.
Always state that figures are estimates for illustration only and are not financial advice.
Use concise GitHub-flavoured Markdown when formatting improves clarity. Do not use raw HTML.

Available MCP tools:
${toolSummary}
`.trim();
}

function shouldUseHsbcCapabilityResponse(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) return true;

  const mortgageTerms = /\b(mortgage|loan|borrow|borrowing|property|deposit|equity|ltv|loan-to-value|repay|repayment|payment|overpay|interest|rate|fixed|tracker|aprc|fee|deal|product)\b/i;
  return !mortgageTerms.test(latestUserMessage.content) && !isCustomerSupportRequest(messages);
}

function isMortgageDealFinderRequest(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) return false;

  return isDealIntentText(latestUserMessage.content);
}

function isCustomerSupportRequest(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return Boolean(latestUserMessage && /\b(contact\s+(?:the\s+)?bank|contact\s+hsbc|customer\s+support|how\s+(?:do|can)\s+i\s+contact)\b/i.test(latestUserMessage.content));
}

function isCapabilityHelpRequest(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return Boolean(latestUserMessage && /^\s*i\s+need\s+help[.!?]*\s*$/i.test(latestUserMessage.content));
}

function isMortgageSpecificSupportRequest(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return Boolean(latestUserMessage && /\bmortgage\b/i.test(latestUserMessage.content));
}

function normalizeMortgageNeed(value) {
  return MORTGAGE_NEED_OPTIONS.some((option) => option.id === value) ? value : null;
}

export function getActiveMortgageWorkflow(messages, mortgageNeed = null) {
  const userMessages = messages.filter((message) => message.role === "user").reverse();
  for (const message of userMessages) {
    if (isRepaymentIntentText(message.content)) return "repayment";
    if (isDealIntentText(message.content)) return "deals";
  }
  return mortgageNeed ? "deals" : null;
}

export function getActiveWorkflowMessages(messages, workflow) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (workflow === "repayment" && isRepaymentIntentText(message.content)) {
      return messages.slice(index);
    }
    if (workflow === "deals" && isDealIntentText(message.content)) {
      return messages.slice(index);
    }
  }
  return messages;
}

function isRepaymentIntentText(text) {
  return /\b(?:calculate|estimate|show|work\s+out|what\s+(?:is|are|will))\b.{0,45}\b(?:mortgage\s+)?repayments?\b/i.test(text) ||
    /\b(?:mortgage\s+)?repayment\s+(?:estimate|calculator|calculation)s?\b/i.test(text) ||
    /\bmonthly\s+(?:mortgage\s+)?payments?\b/i.test(text);
}

function isDealIntentText(text) {
  return /\bmortgage\s+(?:deals?|products?|rates?)\b/i.test(text) ||
    /\b(find|compare|show|search)\b.{0,40}\b(mortgage\s+)?(deal|product|rate)s?\b/i.test(text);
}

function extractMortgageDetails(messages) {
  const details = {};
  const userMessages = messages.filter((message) => message.role === "user").reverse();

  for (const message of userMessages) {
    details.propertyValue ??= extractPounds(
      message.content,
      "(?:property\\s+value|property|home\\s+value)",
    );
    details.loanAmount ??= extractPounds(
      message.content,
      "(?:loan\\s+amount|loan|borrowing\\s+amount|borrowing)",
    );
    details.depositAmount ??= extractPounds(
      message.content,
      "(?:deposit(?:\\s+amount)?|equity)",
    );
    details.termYears ??= extractTermYears(message.content);
  }

  return details;
}

export function extractRepaymentDetails(messages) {
  const details = {};
  const userMessages = messages.filter((message) => message.role === "user").reverse();

  for (const message of userMessages) {
    details.loanAmount ??= extractPounds(
      message.content,
      "(?:loan\\s+amount|loan|borrowing\\s+amount|borrowing)",
    );
    details.annualInterestRatePercent ??= extractPercentage(
      message.content,
      "(?:(?:annual\\s+)?interest\\s+rate|rate)",
    );
    details.termYears ??= extractTermYears(message.content);
    details.monthlyOverpayment ??= extractNonNegativePounds(
      message.content,
      "(?:(?:optional\\s+)?monthly\\s+overpayment|overpayment)",
    );
  }

  return details;
}

function extractPounds(text, labelPattern) {
  const match = text.match(new RegExp(`\\b${labelPattern}\\b\\s*(?:is|:|=|–|-)?\\s*£?\\s*([\\d,.]+)\\s*([km])?\\b`, "i"));
  if (!match) return undefined;

  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return value * multiplier;
}

function extractNonNegativePounds(text, labelPattern) {
  const match = text.match(new RegExp(`\\b${labelPattern}\\b\\s*(?:is|:|=|–|-)?\\s*£?\\s*([\\d,.]+)\\s*([km])?\\b`, "i"));
  if (!match) return undefined;

  const value = Number(match[1].replaceAll(",", ""));
  if (!Number.isFinite(value) || value < 0) return undefined;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return value * multiplier;
}

function extractPercentage(text, labelPattern) {
  const match = text.match(
    new RegExp(`\\b${labelPattern}\\b\\s*(?:\\(%\\))?\\s*(?:is|:|=|–|-)?\\s*([\\d.]+)\\s*%?`, "i"),
  );
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function extractTermYears(text) {
  const match = text.match(/\b(?:mortgage\s+)?term\s*(?:is|:|=|–|-)?\s*(\d{1,2})\s*(?:years?|yrs?)?\b/i);
  if (!match) return undefined;
  const years = Number(match[1]);
  return Number.isInteger(years) && years >= 2 && years <= 40 ? years : undefined;
}

function buildMissingRepaymentDetailsResponse(missingFields) {
  const missingList = missingFields.map((field) => `- ${field}`).join("\n");
  return `To calculate repayment estimates, please provide:\n\n${missingList}\n\nYou can also include an **optional monthly overpayment**; otherwise I’ll use £0. All figures are estimates for illustration only and are not financial advice.`;
}

function describeIncompleteOpenRouterResponse(response) {
  const providerMessage = response?.error?.message ?? response?.message;
  const finishReason = response?.choices?.[0]?.finish_reason;
  return providerMessage
    ? `OpenRouter returned an incomplete response: ${providerMessage}`
    : `OpenRouter returned an incomplete response${finishReason ? ` (${finishReason})` : ""}. Please try again.`;
}

function isDecisionInPrincipleRequest(messages) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!latestUserMessage) return false;

  return /\b(decision\s+(?:in|on)\s+principle|agreement\s+in\s+principle|mortgage\s+decision|decision\s+(?:about|for)\s+(?:a\s+)?mortgage|\b(?:aip|dip)\b)\b/i.test(
    latestUserMessage.content,
  );
}

function buildHsbcCapabilityResponse() {
  return `HSBC Mortgages mode is active. I can help only with these illustrative local tools:

- **Repayment estimates** — calculate monthly repayments, total paid, total interest, and optional overpayment impact.
- **Mortgage deal finder** — choose from seven mortgage journeys, then generate illustrative 2/3/5-year fixed and 2-year tracker products from property value, borrowing amount, and mortgage term. Results include LTV, monthly payment, initial rate, product fee, estimated APRC, and reversion rate.
- **Decision in principle** — open HSBC's online decision-in-principle journey.
- **Customer support** — return official-source-linked phone numbers plus online and mobile chat instructions.
- **Residential deal switching** — open HSBC's existing-customer switching page from eligible illustrative product cards.

Try “mortgage deals”, “contact HSBC”, or ask for a decision in principle. All figures are estimates for illustration only and are not financial advice.`;
}

function isToolDefinition(tool) {
  return tool && typeof tool.name === "string" && tool.inputSchema && typeof tool.inputSchema === "object";
}

async function readMcpResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `MCP request failed with ${response.status}`);
  }

  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(text);
  }

  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (data) {
      return JSON.parse(data);
    }
  }

  throw new Error("MCP stream did not include a JSON-RPC response.");
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new Error("messages must be an array.");
  }

  return messages.slice(-20).map((message) => {
    const role = message?.role;
    const content = String(message?.content ?? "").trim();

    if (!["user", "assistant"].includes(role) || !content) {
      throw new Error("Each message must have role user or assistant and non-empty content.");
    }

    return { role, content };
  });
}

function normalizeEndpoint(value) {
  const endpoint = String(value || DEFAULT_MCP_ENDPOINT).trim();
  const url = new URL(endpoint);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("MCP endpoint must be an HTTP or HTTPS URL.");
  }

  return url.toString();
}

function parsePositiveInteger(value, fallback, fieldName) {
  if (value === undefined || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return parsed;
}

function parseToolAllowlist(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;

  const tools = value.split(",").map((tool) => tool.trim()).filter(Boolean);
  if (tools.length === 0) throw new Error("MCP_ALLOWED_TOOLS must include at least one tool name.");
  return tools;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function writeJson(res, statusCode, value) {
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "content-type": "application/json",
  });

  if (statusCode === 204) {
    res.end();
    return;
  }

  res.end(JSON.stringify(value));
}

function getOpenRouterToken() {
  return process.env.OPENROUTER_API_KEY ?? "";
}
