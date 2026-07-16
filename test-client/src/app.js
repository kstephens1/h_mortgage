import DOMPurify from "dompurify";
import { marked } from "marked";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const TOOL_NAME = "calculate_mortgage_repayment";
const HSBC_LOGO_URL = new URL("../assets/hsbc-logo.png", import.meta.url).href;

const elements = {
  endpoint: document.querySelector("#endpoint"),
  connectButton: document.querySelector("#connect-button"),
  statusPill: document.querySelector("#status-pill"),
  serverName: document.querySelector("#server-name"),
  toolName: document.querySelector("#tool-name"),
  chatLog: document.querySelector("#chat-log"),
  chatForm: document.querySelector("#chat-form"),
  messageInput: document.querySelector("#message-input"),
  sampleButton: document.querySelector("#sample-button"),
  calculateButton: document.querySelector("#calculate-button"),
  clearButton: document.querySelector("#clear-button"),
  resultMetrics: document.querySelector("#result-metrics"),
  rawOutput: document.querySelector("#raw-output"),
  loanAmount: document.querySelector("#loan-amount"),
  interestRate: document.querySelector("#interest-rate"),
  termYears: document.querySelector("#term-years"),
  monthlyOverpayment: document.querySelector("#monthly-overpayment"),
  mentionMenu: document.querySelector("#mention-menu"),
  hsbcMentionOption: document.querySelector("#hsbc-mention-option"),
};

const state = {
  requestId: 1,
  connected: false,
  serverInfo: null,
  tools: [],
  messages: [],
  selectedApp: null,
};

elements.toolName.textContent = TOOL_NAME;
appendAssistantMessage(
  "Ready for a conversational mortgage chat. I can use approved local MCP tools for repayment calculations and illustrative product-rate queries.",
);

elements.connectButton.addEventListener("click", () => {
  connectToServer().catch((error) => showError(error));
});

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = getMessageText();
  if (!text) return;

  clearMessageText();
  appendUserMessage(text);
  applyParsedScenario(text);
  sendChatMessage(text).catch((error) => showError(error));
});

elements.calculateButton.addEventListener("click", () => {
  appendUserMessage(formatScenarioText(readMortgageInput()));
  callMortgageTool().catch((error) => showError(error));
});

elements.sampleButton.addEventListener("click", () => {
  const sample = "Can you compare a 250000 mortgage at 5% over 25 years with a 200 monthly overpayment?";
  setComposerText(sample);
  elements.messageInput.focus();
});

elements.messageInput.addEventListener("input", () => {
  updateComposerState();
  if (!state.selectedApp && getMessageText().includes("@")) {
    showMentionMenu();
  } else if (!getMessageText().includes("@")) {
    hideMentionMenu();
  }
});

elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!elements.mentionMenu.hidden) {
      selectHsbcMention();
    } else {
      elements.chatForm.requestSubmit();
    }
  }

  if (event.key === "Escape") hideMentionMenu();
});

elements.hsbcMentionOption.addEventListener("click", selectHsbcMention);

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".composer-entry")) hideMentionMenu();
});

elements.clearButton.addEventListener("click", () => {
  state.messages = [];
  elements.chatLog.replaceChildren();
  elements.resultMetrics.textContent = "No result yet";
  elements.resultMetrics.className = "metrics empty-state";
  elements.rawOutput.textContent = "{}";
  appendAssistantMessage(
    "Chat cleared. The current mortgage details are still available in the form.",
  );
});

async function sendChatMessage(text) {
  state.messages.push({ role: "user", content: text });
  setBusy(true);
  setStatus("running", "Thinking");

  const response = await fetch("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: state.messages,
      mcpEndpoint: elements.endpoint.value.trim(),
      hsbcMode: state.selectedApp === "HSBC Mortgages",
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Chat request failed with ${response.status}`);
  }

  const reply = body.reply ?? "I could not produce a response.";
  state.messages.push({ role: "assistant", content: reply });
  const hsbcResponded = body.source === "mcp" || body.source === "hsbc-guidance";
  appendAssistantMessage(reply, { mcpResponded: hsbcResponded });

  const latestToolResult = body.toolResults?.at(-1)?.result;
  if (latestToolResult) {
    renderResult(latestToolResult, body);
  } else {
    elements.rawOutput.textContent = JSON.stringify(body, null, 2);
  }

  setStatus("connected", "Ready");
  setBusy(false);
}

async function connectToServer() {
  setBusy(true);
  setStatus("connecting", "Connecting");

  const initResult = await mcpRequest("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: "chathsbc-test-client",
      version: "0.1.0",
    },
  });

  const toolsResult = await mcpRequest("tools/list", {});
  state.connected = true;
  state.serverInfo = initResult.serverInfo;
  state.tools = toolsResult.tools ?? [];

  const hasTool = state.tools.some((tool) => tool.name === TOOL_NAME);
  if (!hasTool) {
    throw new Error(`Connected, but ${TOOL_NAME} was not returned by tools/list.`);
  }

  elements.serverName.textContent = `${state.serverInfo.name} ${state.serverInfo.version}`;
  setStatus("connected", "Ready");
  appendAssistantMessage(
    `Connected to ${state.serverInfo.name}. Direct MCP test calls are available.`,
  );
  setBusy(false);
}

async function callMortgageTool() {
  if (!state.connected) {
    await connectToServer();
  }

  const input = readMortgageInput();
  validateMortgageInput(input);
  setBusy(true);
  setStatus("running", "Running");

  const result = await mcpRequest("tools/call", {
    name: TOOL_NAME,
    arguments: input,
  });

  const text = result.content?.find((item) => item.type === "text")?.text;
  appendAssistantMessage(text ?? "Tool returned a result.", { mcpResponded: true });
  renderResult(result, { source: "direct-mcp" });
  setStatus("connected", "Ready");
  setBusy(false);
}

async function mcpRequest(method, params) {
  const response = await fetch(elements.endpoint.value.trim(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: state.requestId++,
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

async function readMcpResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `MCP request failed with ${response.status}`);
  }

  if (contentType.includes("text/event-stream")) {
    return parseEventStream(text);
  }

  return JSON.parse(text);
}

function parseEventStream(text) {
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

function applyParsedScenario(text) {
  const parsed = parseScenario(text);
  if (parsed.loanAmount !== undefined) elements.loanAmount.value = parsed.loanAmount;
  if (parsed.annualInterestRatePercent !== undefined) {
    elements.interestRate.value = parsed.annualInterestRatePercent;
  }
  if (parsed.termYears !== undefined) elements.termYears.value = parsed.termYears;
  if (parsed.monthlyOverpayment !== undefined) {
    elements.monthlyOverpayment.value = parsed.monthlyOverpayment;
  }
}

function parseScenario(text) {
  const normalized = text.toLowerCase().replaceAll(",", "");
  const parsed = {};
  const rateMatch =
    normalized.match(/(\d+(?:\.\d+)?)\s*%/) ??
    normalized.match(/rate\D{0,12}(\d+(?:\.\d+)?)/);
  const termMatch =
    normalized.match(/(\d+)\s*(?:year|years|yr|yrs)/) ??
    normalized.match(/term\D{0,12}(\d+)/);
  const overpaymentMatch =
    normalized.match(/(?:overpayment|overpay|extra)\D{0,16}(\d+(?:\.\d+)?)([km])?/) ??
    normalized.match(/(\d+(?:\.\d+)?)([km])?\s*(?:overpayment|overpay|extra)/);
  const loanMatch =
    normalized.match(/(?:loan|mortgage|borrow|borrowing|amount|principal)\D{0,16}(\d+(?:\.\d+)?)([km])?/) ??
    normalized.match(/(\d+(?:\.\d+)?)([km])?\s*(?:loan|mortgage|borrowed)/) ??
    normalized.match(/^(\d+(?:\.\d+)?)([km])?/);

  if (loanMatch) parsed.loanAmount = parseScaledNumber(loanMatch[1], loanMatch[2]);
  if (rateMatch) parsed.annualInterestRatePercent = Number(rateMatch[1]);
  if (termMatch) parsed.termYears = Number.parseInt(termMatch[1], 10);
  if (overpaymentMatch) {
    parsed.monthlyOverpayment = parseScaledNumber(
      overpaymentMatch[1],
      overpaymentMatch[2],
    );
  }

  return parsed;
}

function parseScaledNumber(value, suffix) {
  const numericValue = Number(value);
  if (suffix === "k") return numericValue * 1_000;
  if (suffix === "m") return numericValue * 1_000_000;
  return numericValue;
}

function readMortgageInput() {
  return {
    loanAmount: Number(elements.loanAmount.value),
    annualInterestRatePercent: Number(elements.interestRate.value),
    termYears: Number.parseInt(elements.termYears.value, 10),
    monthlyOverpayment: Number(elements.monthlyOverpayment.value || 0),
  };
}

function validateMortgageInput(input) {
  if (!Number.isFinite(input.loanAmount) || input.loanAmount <= 0) {
    throw new Error("Loan amount must be greater than zero.");
  }
  if (
    !Number.isFinite(input.annualInterestRatePercent) ||
    input.annualInterestRatePercent < 0
  ) {
    throw new Error("Rate percent must be zero or greater.");
  }
  if (!Number.isInteger(input.termYears) || input.termYears <= 0) {
    throw new Error("Term years must be a positive whole number.");
  }
  if (!Number.isFinite(input.monthlyOverpayment) || input.monthlyOverpayment < 0) {
    throw new Error("Overpayment must be zero or greater.");
  }
}

function renderResult(result, rawPayload = result) {
  const structured = result.structuredContent;
  elements.rawOutput.textContent = JSON.stringify(rawPayload, null, 2);

  if (!structured) {
    elements.resultMetrics.textContent = "No structured result returned";
    elements.resultMetrics.className = "metrics empty-state";
    return;
  }

  const metrics = [
    ["Monthly", formatCurrency(structured.monthlyPayment)],
    ["Total Paid", formatCurrency(structured.totalPaid)],
    ["Interest", formatCurrency(structured.totalInterest)],
    ["With Overpay", formatCurrency(structured.monthlyPaymentWithOverpayment)],
  ];

  if (structured.overpaymentImpact) {
    metrics.push(
      ["Time Saved", `${structured.overpaymentImpact.timeSavedMonths} months`],
      ["Interest Saved", formatCurrency(structured.overpaymentImpact.interestSaved)],
    );
  }

  elements.resultMetrics.className = "metrics";
  elements.resultMetrics.replaceChildren(
    ...metrics.map(([label, value]) => {
      const item = document.createElement("div");
      const labelNode = document.createElement("span");
      const valueNode = document.createElement("strong");
      labelNode.textContent = label;
      valueNode.textContent = value;
      item.append(labelNode, valueNode);
      return item;
    }),
  );
}

function appendUserMessage(text) {
  appendMessage("user", text);
}

function getMessageText() {
  return [...elements.messageInput.childNodes]
    .filter((node) => !(node instanceof HTMLElement && node.classList.contains("app-chip")))
    .map((node) => node.textContent ?? "")
    .join("")
    .trim();
}

function showMentionMenu() {
  elements.mentionMenu.hidden = false;
  elements.hsbcMentionOption.setAttribute("aria-selected", "true");
}

function hideMentionMenu() {
  elements.mentionMenu.hidden = true;
  elements.hsbcMentionOption.setAttribute("aria-selected", "false");
}

function selectHsbcMention() {
  const typedText = getMessageText().replace("@", "").trimStart();
  state.selectedApp = "HSBC Mortgages";

  const chip = document.createElement("span");
  chip.className = "app-chip";
  chip.contentEditable = "false";
  chip.setAttribute("aria-label", "HSBC Mortgages selected");

  const icon = document.createElement("img");
  icon.src = HSBC_LOGO_URL;
  icon.alt = "";
  const label = document.createElement("span");
  label.textContent = state.selectedApp;
  chip.append(icon, label);

  elements.messageInput.replaceChildren(chip, document.createTextNode(` ${typedText}`));
  updateComposerState();
  hideMentionMenu();
  placeCaretAtEnd(elements.messageInput);
}

function clearMessageText() {
  setComposerText("");
  hideMentionMenu();
  placeCaretAtEnd(elements.messageInput);
}

function setComposerText(text) {
  const chip = elements.messageInput.querySelector(".app-chip");
  if (chip) {
    elements.messageInput.replaceChildren(chip, document.createTextNode(` ${text}`));
  } else {
    elements.messageInput.replaceChildren();
    if (text) elements.messageInput.textContent = text;
  }
  updateComposerState();
}

function updateComposerState() {
  const chipIsPresent = Boolean(elements.messageInput.querySelector(".app-chip"));
  if (!chipIsPresent) state.selectedApp = null;

  const isEmpty = !chipIsPresent && !getMessageText();
  elements.messageInput.classList.toggle("is-empty", isEmpty);
}

function placeCaretAtEnd(element) {
  element.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function appendAssistantMessage(text, options) {
  appendMessage("assistant", text, options);
}

function appendMessage(
  role,
  text,
  { mcpResponded = false, renderMarkdown = role === "assistant" } = {},
) {
  const message = document.createElement("article");
  message.className = `message ${role}`;

  const header = document.createElement("div");
  header.className = "message-header";

  const roleNode = document.createElement("span");
  roleNode.className = "message-role";
  roleNode.textContent = role === "user" ? "You" : "Assistant";

  header.append(roleNode);
  if (role === "assistant" && mcpResponded) {
    header.append(createHsbcResponseChip());
  }

  const body = document.createElement("div");
  body.className = "message-content";
  if (renderMarkdown) {
    renderMarkdownContent(body, text);
  } else {
    body.textContent = text;
  }

  message.append(header, body);
  elements.chatLog.append(message);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function renderMarkdownContent(container, text) {
  try {
    const markdownHtml = marked.parse(text, { gfm: true, breaks: true });
    const safeHtml = DOMPurify.sanitize(markdownHtml, {
      ALLOWED_TAGS: [
        "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
        "hr", "li", "ol", "p", "pre", "strong", "table", "thead", "tbody", "tr", "th", "td", "ul",
      ],
      ALLOWED_ATTR: ["href", "title"],
    });
    const template = document.createElement("template");
    template.innerHTML = safeHtml;
    for (const link of template.content.querySelectorAll("a[href]")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    container.append(template.content);
  } catch {
    container.textContent = text;
  }
}

function createHsbcResponseChip() {
  const chip = document.createElement("span");
  chip.className = "response-source-chip";
  chip.setAttribute("aria-label", "Response backed by HSBC Mortgages MCP");

  const icon = document.createElement("img");
  icon.src = HSBC_LOGO_URL;
  icon.alt = "";
  const label = document.createElement("span");
  label.textContent = "HSBC Mortgages";
  chip.append(icon, label);
  return chip;
}

function showError(error) {
  setBusy(false);
  setStatus(state.connected ? "connected" : "error", state.connected ? "Ready" : "Error");
  appendAssistantMessage(error instanceof Error ? error.message : String(error), {
    renderMarkdown: false,
  });
}

function setBusy(isBusy) {
  elements.connectButton.disabled = isBusy;
  elements.calculateButton.disabled = isBusy;
  elements.chatForm.querySelector("button[type='submit']").disabled = isBusy;
}

function setStatus(status, label) {
  elements.statusPill.dataset.status = status;
  elements.statusPill.textContent = label;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(value);
}

function formatScenarioText(input) {
  const overpayment =
    input.monthlyOverpayment > 0
      ? ` with ${input.monthlyOverpayment} monthly overpayment`
      : "";
  return `${input.loanAmount} at ${input.annualInterestRatePercent}% for ${input.termYears} years${overpayment}`;
}
