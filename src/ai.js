// Small client for the local LLM (Qwen3 through Ollama's OpenAI-compatible API).
// Every AI call in the app goes through chat() or completeJSON(), so tests can
// swap in a fake object with the same two methods and never need a running model.

// Ollama is not running, the model isn't pulled, or the call timed out (the API turns these into 503)
class AIUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

// The model answered, but not with something we can use (bad JSON, wrong shape, made-up numbers)
class AIOutputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AIOutputError';
  }
}

// Qwen3 can put its reasoning inline as <think>...</think>; it is never part of the answer
const stripThinking = (text) => String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

function parseJSON(text) {
  const clean = stripThinking(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(clean);
  } catch { /* try the outermost {...} below */ }
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new AIOutputError(`reply was not valid JSON: ${JSON.stringify(clean.slice(0, 120))}`);
}

// Reads an OpenAI-style server-sent-event stream. Text is passed to onDelta as it arrives;
// tool calls are put back together by index (Ollama sends each one whole, OpenAI in pieces).
async function readStream(body, onDelta) {
  let content = '', buffer = '';
  const calls = [];
  const decoder = new TextDecoder();
  const line = (text) => {
    const data = text.startsWith('data:') ? text.slice(5).trim() : '';
    if (!data || data === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    const delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) || {};
    if (delta.content) {
      content += delta.content;
      onDelta(delta.content);
    }
    (delta.tool_calls || []).forEach((tc) => {
      const i = Number.isInteger(tc.index) ? tc.index : calls.length;
      const call = calls[i] || (calls[i] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } });
      if (tc.id) call.id = tc.id;
      if (tc.function && tc.function.name) call.function.name = tc.function.name;
      if (tc.function && tc.function.arguments) {
        call.function.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
      }
    });
  };
  for await (const part of body) {
    buffer += decoder.decode(part, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach((l) => line(l.trim()));
  }
  line(buffer.trim());
  return { content, tool_calls: calls.filter(Boolean) };
}

function createAiClient({ url, model, timeoutMs, keepAlive, fetch: fetchFn = globalThis.fetch } = {}) {
  const base = (url || process.env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, '');
  const name = model || process.env.AI_MODEL || 'qwen3:8b';
  const timeout = Number(timeoutMs || process.env.AI_TIMEOUT_MS) || 120000;
  // keeps the model loaded between requests so it doesn't reload after idle time (/v1 honours it, checked on 0.40.4)
  const keep = keepAlive || process.env.AI_KEEP_ALIVE || '30m';

  // messages: OpenAI-style [{ role, content }]. Returns { content, toolCalls, message }
  // where message is the assistant turn to push back into the conversation.
  // With onDelta the reply is streamed and each piece of text is passed to it as it arrives.
  async function chat(messages, { tools, think = true, json = false, temperature, maxTokens, onDelta } = {}) {
    const body = { model: name, messages, stream: !!onDelta, keep_alive: keep };
    if (tools && tools.length) body.tools = tools;
    if (json) body.response_format = { type: 'json_object' };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens) body.max_tokens = maxTokens;
    // Ollama's /v1 endpoint ignores the native "think" field (checked on 0.40.4);
    // reasoning_effort "none" is what actually turns Qwen3 thinking off there
    if (!think) Object.assign(body, { think: false, reasoning_effort: 'none' });

    let res;
    try {
      res = await fetchFn(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw new AIUnavailableError(`could not reach ${base}: ${err.message}`);
    }
    // 404 = model not pulled, 5xx = Ollama itself failed: either way there is no AI right now
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AIUnavailableError(`${base} answered ${res.status}: ${text.slice(0, 200)}`);
    }
    let msg;
    if (onDelta) {
      try {
        msg = await readStream(res.body, onDelta);
      } catch (err) {
        throw new AIUnavailableError(`the stream from ${base} broke off: ${err.message}`);
      }
    } else {
      const data = await res.json().catch(() => null);
      msg = data && data.choices && data.choices[0] && data.choices[0].message;
    }
    if (!msg) throw new AIUnavailableError(`${base} sent a reply with no message`);

    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function && tc.function.name,
      arguments: tc.function && tc.function.arguments,
    }));
    const message = { role: 'assistant', content: msg.content || '' };
    if (msg.tool_calls && msg.tool_calls.length) message.tool_calls = msg.tool_calls;
    return { content: stripThinking(msg.content), toolCalls, message };
  }

  // Asks for a JSON object (thinking off, temperature 0) and returns it parsed.
  // Checking the shape is up to the caller.
  async function completeJSON(messages, options = {}) {
    const { content } = await chat(messages, { think: false, temperature: 0, ...options, json: true });
    return parseJSON(content);
  }

  return { chat, completeJSON, model: name, url: base };
}

module.exports = { createAiClient, AIUnavailableError, AIOutputError, parseJSON, stripThinking };
