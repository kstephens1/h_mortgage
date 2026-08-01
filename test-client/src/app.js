import DOMPurify from "dompurify";
import { marked } from "marked";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const TOOL_NAME = "calculate_mortgage_repayment";
const PRODUCT_TOOL_NAME = "find_mortgage_product_rates";
const HSBC_LOGO_URL = new URL("../assets/hsbc-logo.png", import.meta.url).href;
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const DEFAULT_MCP_ENDPOINT =
  import.meta.env.VITE_MCP_ENDPOINT ?? "http://127.0.0.1:8787/mcp";
const SESSION_STORAGE_KEY = "chat-h-session";

const elements = {
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginError: document.querySelector("#login-error"),
  appShell: document.querySelector("#app-shell"),
  logoutButton: document.querySelector("#logout-button"),
  endpoint: document.querySelector("#endpoint"),
  connectButton: document.querySelector("#connect-button"),
  statusPill: document.querySelector("#status-pill"),
  serverName: document.querySelector("#server-name"),
  toolName: document.querySelector("#tool-name"),
  chatLog: document.querySelector("#chat-log"),
  chatForm: document.querySelector("#chat-form"),
  messageInput: document.querySelector("#message-input"),
  clearButton: document.querySelector("#clear-button"),
  resultMetrics: document.querySelector("#result-metrics"),
  rawOutput: document.querySelector("#raw-output"),
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
  selectedMortgageNeed: null,
  historyIndex: null,
  historyDraft: "",
  token: null,
};

elements.endpoint.value = DEFAULT_MCP_ENDPOINT;
elements.toolName.textContent = TOOL_NAME;
appendAssistantMessage(
  "Hi! How can I help? Type @ to add HSBC Mortgages when you want mortgage-specific assistance.",
);

elements.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  login().catch((error) => showLoginError(error));
});

elements.logoutButton.addEventListener("click", () => {
  clearSession();
  showLoginScreen();
});

elements.connectButton.addEventListener("click", () => {
  connectToServer().catch((error) => showError(error));
});

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = getMessageText();
  if (!text) return;

  clearMessageText();
  resetHistoryNavigation();
  appendUserMessage(text);
  sendChatMessage(text).catch((error) => showError(error));
});

elements.messageInput.addEventListener("input", () => {
  resetHistoryNavigation();
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

  if (
    (event.key === "ArrowUp" || event.key === "ArrowDown") &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    (state.historyIndex !== null || !getMessageText())
  ) {
    const didCycle = cycleMessageHistory(event.key === "ArrowUp" ? -1 : 1);
    if (didCycle) event.preventDefault();
  }
});

elements.hsbcMentionOption.addEventListener("click", selectHsbcMention);

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".composer-entry")) hideMentionMenu();
});

elements.clearButton.addEventListener("click", () => {
  state.messages = [];
  state.selectedMortgageNeed = null;
  resetHistoryNavigation();
  elements.chatLog.replaceChildren();
  elements.resultMetrics.textContent = "No result yet";
  elements.resultMetrics.className = "metrics empty-state";
  elements.rawOutput.textContent = "{}";
  appendAssistantMessage(
    "Chat cleared. How can I help? Type @ to add HSBC Mortgages for mortgage-specific assistance.",
  );
});

async function sendChatMessage(text) {
  state.messages.push({ role: "user", content: text });
  setBusy(true);
  setStatus("running", "Thinking");
  appendThinkingIndicator();

  const response = await authenticatedFetch(apiUrl("/chat"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: state.messages,
      mcpEndpoint: elements.endpoint.value.trim(),
      hsbcMode: state.selectedApp === "HSBC Mortgages",
      mortgageNeed: state.selectedMortgageNeed,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `Chat request failed with ${response.status}`);
  }

  const reply = body.reply ?? "I could not produce a response.";
  state.messages.push({ role: "assistant", content: reply });
  const hsbcResponded = body.source === "mcp" || body.source === "hsbc-guidance";
  removeThinkingIndicator();
  appendAssistantMessage(reply, { mcpResponded: hsbcResponded });
  if (body.action?.label && body.action?.url) {
    appendChatAction(body.action);
  }
  if (Array.isArray(body.actions)) {
    if (body.actions.some((action) => action.kind === "mortgage-need")) {
      state.selectedMortgageNeed = null;
    }
    appendChatActions(body.actions);
  }

  const latestToolResult = body.toolResults?.at(-1)?.result;
  if (latestToolResult) {
    renderResult(latestToolResult, body);
    if (Array.isArray(latestToolResult.structuredContent?.products)) {
      appendProductResults(latestToolResult.structuredContent);
    }
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

  const hasMortgageTools = [TOOL_NAME, PRODUCT_TOOL_NAME].every((toolName) =>
    state.tools.some((tool) => tool.name === toolName),
  );
  if (!hasMortgageTools) {
    throw new Error("Connected, but the expected mortgage tools were not returned by tools/list.");
  }

  elements.serverName.textContent = `${state.serverInfo.name} ${state.serverInfo.version}`;
  setStatus("connected", "Ready");
  appendAssistantMessage(
    `Connected to ${state.serverInfo.name}. Direct MCP test calls are available.`,
  );
  setBusy(false);
}

async function mcpRequest(method, params) {
  const response = await authenticatedFetch(elements.endpoint.value.trim(), {
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

function renderResult(result, rawPayload = result) {
  const structured = result.structuredContent;
  elements.rawOutput.textContent = JSON.stringify(rawPayload, null, 2);

  if (!structured) {
    elements.resultMetrics.textContent = "No structured result returned";
    elements.resultMetrics.className = "metrics empty-state";
    return;
  }

  if (Array.isArray(structured.products)) {
    elements.resultMetrics.className = "metrics";
    elements.resultMetrics.replaceChildren(
      createMetric("Products", String(structured.products.length)),
      createMetric("LTV", `${structured.loanToValuePercent}%`),
      createMetric("Term", `${structured.termYears} years`),
      createMetric("Deposit", formatCurrency(structured.depositAmount)),
    );
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
  elements.resultMetrics.replaceChildren(...metrics.map(([label, value]) => createMetric(label, value)));
}

function createMetric(label, value) {
  const item = document.createElement("div");
  const labelNode = document.createElement("span");
  const valueNode = document.createElement("strong");
  labelNode.textContent = label;
  valueNode.textContent = value;
  item.append(labelNode, valueNode);
  return item;
}

function appendProductResults(result) {
  if (!result || !Array.isArray(result.products)) return;

  const message = document.createElement("article");
  message.className = "message assistant product-results";
  const header = document.createElement("div");
  header.className = "message-header";
  const roleNode = document.createElement("span");
  roleNode.className = "message-role";
  roleNode.textContent = `Illustrative deals · ${result.loanToValuePercent}% LTV`;
  header.append(roleNode, createHsbcResponseChip());

  const cards = document.createElement("div");
  cards.className = "product-cards";
  for (const product of result.products) {
    const card = document.createElement("section");
    card.className = "product-card";
    const title = document.createElement("h3");
    title.textContent = product.name;
    const highlights = document.createElement("div");
    highlights.className = "product-highlights";
    for (const [label, value] of [
      ["Monthly payment", formatCurrency(product.monthlyPayment)],
      [
        product.rateType === "fixed"
          ? `Fixed rate for ${product.initialPeriodYears} years`
          : `Variable rate for ${product.initialPeriodYears} years`,
        `${product.initialRatePercent.toFixed(2)}%`,
      ],
      ["Booking fee", formatCurrency(product.productFee)],
      ["Annual Percentage Rate of Charge (APRC)", `${product.annualPercentageRatePercent.toFixed(2)}%`],
      [
        `Variable rate after ${product.initialPeriodYears} years`,
        `${product.reversionRatePercent.toFixed(2)}%`,
      ],
    ]) {
      highlights.append(createProductFact(label, value));
    }
    const ltv = document.createElement("div");
    ltv.className = "product-ltv";
    ltv.innerHTML = `<strong>${product.maximumLoanToValuePercent}%</strong><span>Max Loan to Value</span>`;
    const features = document.createElement("div");
    features.className = "product-features";
    for (const feature of product.features) {
      const featureNode = document.createElement("span");
      featureNode.textContent = feature;
      features.append(featureNode);
    }
    const actions = document.createElement("div");
    actions.className = "product-actions";
    const details = document.createElement("button");
    details.type = "button";
    details.className = "product-link-button";
    details.textContent = "⌄  View details";
    const glossary = document.createElement("span");
    glossary.className = "product-glossary";
    glossary.textContent = "↗  Mortgage terms glossary";
    const isResidentialSwitch = result.mortgageNeed === "switch_residential";
    const switchDeal = document.createElement(isResidentialSwitch ? "a" : "button");
    switchDeal.className = "switch-deal-button";
    switchDeal.textContent = "Switch your deal";
    if (isResidentialSwitch) {
      switchDeal.href = "https://www.hsbc.co.uk/mortgages/existing-customers/switch/";
      switchDeal.target = "_blank";
      switchDeal.rel = "noopener noreferrer";
    } else {
      switchDeal.type = "button";
      switchDeal.addEventListener("click", () => {
        switchDeal.textContent = "Deal selected";
        switchDeal.disabled = true;
      });
    }
    actions.append(details, glossary, switchDeal);
    card.append(title, highlights, ltv, features, actions);
    cards.append(card);
  }

  const disclaimer = document.createElement("p");
  disclaimer.className = "product-disclaimer";
  disclaimer.textContent = result.disclaimer;
  message.append(header, cards, disclaimer);
  elements.chatLog.append(message);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function createProductFact(label, value) {
  const fact = document.createElement("div");
  const valueNode = document.createElement("strong");
  const labelNode = document.createElement("span");
  valueNode.textContent = value;
  labelNode.textContent = label;
  fact.append(valueNode, labelNode);
  return fact;
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
  if (!chipIsPresent) {
    state.selectedApp = null;
    state.selectedMortgageNeed = null;
  }

  const isEmpty = !chipIsPresent && !getMessageText();
  elements.messageInput.classList.toggle("is-empty", isEmpty);
}

function cycleMessageHistory(direction) {
  const history = state.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);

  if (history.length === 0) return false;

  if (state.historyIndex === null) {
    state.historyDraft = getMessageText();
    if (direction > 0) return false;
    state.historyIndex = history.length - 1;
  } else {
    const nextIndex = state.historyIndex + direction;
    if (nextIndex >= history.length) {
      state.historyIndex = null;
      setComposerText(state.historyDraft);
      placeCaretAtEnd(elements.messageInput);
      return true;
    }
    state.historyIndex = Math.max(0, nextIndex);
  }

  setComposerText(history[state.historyIndex]);
  placeCaretAtEnd(elements.messageInput);
  return true;
}

function resetHistoryNavigation() {
  state.historyIndex = null;
  state.historyDraft = "";
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

function appendThinkingIndicator() {
  if (elements.chatLog.querySelector(".thinking-message")) return;

  const message = document.createElement("article");
  message.className = "message assistant thinking-message";
  message.setAttribute("role", "status");
  message.setAttribute("aria-label", "Assistant is thinking");

  const text = document.createElement("span");
  text.className = "thinking-text";
  text.textContent = "Thinking";
  message.append(text);
  elements.chatLog.append(message);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function removeThinkingIndicator() {
  elements.chatLog.querySelector(".thinking-message")?.remove();
}

function appendChatAction(action) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-action";
  const link = document.createElement("a");
  link.className = "decision-link";
  link.href = action.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = action.label;
  wrapper.append(link);
  elements.chatLog.append(wrapper);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function appendChatActions(actions) {
  const wrapper = document.createElement("div");
  wrapper.className = "chat-actions";
  for (const action of actions) {
    if (action.kind !== "mortgage-need" || !action.id || !action.label) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mortgage-need-button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      for (const sibling of wrapper.querySelectorAll("button")) sibling.disabled = true;
      state.selectedMortgageNeed = action.id;
      const text = `I want to ${action.label.toLowerCase()}.`;
      appendUserMessage(text);
      sendChatMessage(text).catch((error) => showError(error));
    });
    wrapper.append(button);
  }
  if (wrapper.childElementCount) {
    elements.chatLog.append(wrapper);
    elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  }
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
  removeThinkingIndicator();
  setBusy(false);
  setStatus(state.connected ? "connected" : "error", state.connected ? "Ready" : "Error");
  appendAssistantMessage(error instanceof Error ? error.message : String(error), {
    renderMarkdown: false,
  });
}

async function login() {
  const submitButton = elements.loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  elements.loginError.hidden = true;
  const data = new FormData(elements.loginForm);

  try {
    const response = await fetch(apiUrl("/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error ?? "Sign in failed.");
    }
    state.token = body.token;
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      token: body.token,
      expiresAt: body.expiresAt,
    }));
    elements.loginForm.reset();
    showApp();
  } finally {
    submitButton.disabled = false;
  }
}

async function restoreSession() {
  const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) {
    showLoginScreen();
    return;
  }

  try {
    const session = JSON.parse(stored);
    if (!session.token || Date.parse(session.expiresAt) <= Date.now()) {
      throw new Error("Session expired");
    }
    state.token = session.token;
    const response = await authenticatedFetch(apiUrl("/health"));
    if (!response.ok) throw new Error("Session expired");
    showApp();
  } catch {
    clearSession();
    showLoginScreen();
  }
}

async function authenticatedFetch(url, options = {}) {
  if (!state.token) {
    throw new Error("Authentication required.");
  }
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${state.token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    clearSession();
    showLoginScreen();
    throw new Error("Your session has expired. Please sign in again.");
  }
  return response;
}

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

function showLoginError(error) {
  elements.loginError.textContent = error instanceof Error ? error.message : String(error);
  elements.loginError.hidden = false;
}

function clearSession() {
  state.token = null;
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function showLoginScreen() {
  elements.appShell.hidden = true;
  elements.loginScreen.hidden = false;
  elements.loginForm.querySelector("#username").focus();
}

function showApp() {
  elements.loginScreen.hidden = true;
  elements.appShell.hidden = false;
}

function setBusy(isBusy) {
  elements.connectButton.disabled = isBusy;
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

restoreSession();
