import { createServer } from "node:http";

const HOST = process.env.TEST_CLIENT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.TEST_CLIENT_API_PORT ?? 5174);
const DEFAULT_MCP_ENDPOINT = process.env.MCP_ENDPOINT ?? "http://127.0.0.1:8787/mcp";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "xiaomi/mimo-v2-flash";
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const OPENROUTER_MAX_TOKENS = parsePositiveInteger(
  process.env.OPENROUTER_MAX_TOKENS,
  4096,
  "OPENROUTER_MAX_TOKENS",
);
const ALLOWED_MCP_TOOLS = parseToolAllowlist(
  process.env.MCP_ALLOWED_TOOLS,
  ["calculate_mortgage_repayment", "find_mortgage_product_rates"],
);
const MAX_TOOL_LOOPS = 4;

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

server.listen(PORT, HOST, () => {
  console.log(
    `ChatHSBC orchestrator listening on http://${HOST}:${PORT} using ${OPENROUTER_MODEL}`,
  );
});

async function runChat(body) {
  const token = getOpenRouterToken();
  if (!token) {
    throw new Error(
      "Missing OpenRouter API key. Set OPENROUTER_API_KEY in test-client/.env before starting the test client.",
    );
  }

  const messages = normalizeMessages(body?.messages);
  const mcpEndpoint = normalizeEndpoint(body?.mcpEndpoint);
  const hsbcMode = body?.hsbcMode === true;
  const availableTools = await discoverAllowedTools(mcpEndpoint);
  const input = [
    { role: "system", content: buildSystemInstructions(availableTools, hsbcMode) },
    ...messages,
  ];
  const toolResults = [];

  for (let i = 0; i < MAX_TOOL_LOOPS; i += 1) {
    const response = await createChatCompletion(token, input, availableTools);
    const assistantMessage = response.choices?.[0]?.message;
    if (!assistantMessage) {
      throw new Error("OpenRouter returned no assistant message.");
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
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-openrouter-title": "ChatHSBC Test Client",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: OPENROUTER_MAX_TOKENS,
      messages,
      tools: availableTools.map(toOpenRouterTool),
    }),
  });

  const body = await response.json().catch(async () => ({
    error: { message: await response.text() },
  }));

  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenRouter request failed with ${response.status}`);
  }

  return body;
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

function buildSystemInstructions(availableTools, hsbcMode) {
  const toolSummary = availableTools.length
    ? availableTools.map((tool) => `- ${tool.name}: ${tool.description ?? tool.title ?? "No description provided."}`).join("\n")
    : "- No approved MCP tools are currently available.";

  const modeInstructions = hsbcMode
    ? `
HSBC Mortgages mode is active. Restrict every response to the available HSBC MCP capabilities below.
For a request covered by a tool, call that tool. If its required inputs are missing, ask only for the missing inputs.
For a mortgage request not covered by a tool, use a short, helpful capability response based only on the list below. Explain which supported actions are available and that there is no available MCP tool for the requested action.
For non-mortgage requests, explain that HSBC Mortgages mode is limited to the listed mortgage capabilities.
Never provide general mortgage guidance, live rates, product availability, eligibility decisions, HSBC policy, customer-service contact details, or facts not returned by a tool.
`
    : `
For mortgage topics not covered by an available tool, provide general educational guidance only. Do not invent live rates, product availability, eligibility decisions, or HSBC policy.
`;

  return `
You are a concise UK mortgage assistant for testing local MCP tools.
Use an available MCP tool when it is the best way to answer a calculation, product-rate, or other tool-covered mortgage request.
Ask a short, focused follow-up question when an available tool needs information the user has not provided.
${modeInstructions}
When a tool result is available, explain it in plain English and retain its disclaimers.
Always state that figures are estimates for illustration only and are not financial advice.
Use concise GitHub-flavoured Markdown when formatting improves clarity. Do not use raw HTML.

Available MCP tools:
${toolSummary}
`.trim();
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
