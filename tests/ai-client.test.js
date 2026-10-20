// Unit tests for src/ai.js with a fake fetch (no Ollama needed).
const { createAiClient, AIUnavailableError, AIOutputError, parseJSON } = require('../src/ai');

// fetch stand-in that records the request and answers with one OpenAI-style message
function fakeFetch(message, { status = 200 } = {}) {
  const f = async (url, init) => {
    f.url = url;
    f.body = JSON.parse(init.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message }] }),
      text: async () => 'model "qwen3:8b" not found',
    };
  };
  return f;
}

describe('AI client', () => {
  test('AI posts to the OpenAI-compatible endpoint with the configured model', async () => {
    const fetch = fakeFetch({ role: 'assistant', content: 'hi' });
    const ai = createAiClient({ url: 'http://ollama:11434/', model: 'qwen3:8b', fetch });
    const out = await ai.chat([{ role: 'user', content: 'hello' }]);
    expect(fetch.url).toBe('http://ollama:11434/v1/chat/completions');
    expect(fetch.body).toMatchObject({ model: 'qwen3:8b', stream: false, messages: [{ role: 'user', content: 'hello' }] });
    expect(fetch.body).not.toHaveProperty('reasoning_effort'); // thinking stays on unless asked
    expect(out).toEqual({ content: 'hi', toolCalls: [], message: { role: 'assistant', content: 'hi' } });
  });

  test('AI uses OLLAMA_URL and AI_MODEL from the environment', async () => {
    const saved = { ...process.env };
    process.env.OLLAMA_URL = 'http://gpu-box:1234';
    process.env.AI_MODEL = 'qwen3:4b';
    const fetch = fakeFetch({ content: 'ok' });
    await createAiClient({ fetch }).chat([]);
    process.env = saved;
    expect(fetch.url).toBe('http://gpu-box:1234/v1/chat/completions');
    expect(fetch.body.model).toBe('qwen3:4b');
  });

  test('AI think:false turns Qwen3 thinking off (reasoning_effort none) and strips <think>', async () => {
    const fetch = fakeFetch({ content: '<think>hmm</think>\nAnswer' });
    const out = await createAiClient({ fetch }).chat([], { think: false });
    expect(fetch.body).toMatchObject({ think: false, reasoning_effort: 'none' });
    expect(out.content).toBe('Answer');
  });

  test('AI returns tool calls and the assistant message to send back', async () => {
    const tool_calls = [{ id: 'call_1', type: 'function', function: { name: 'score_contributions', arguments: '{"since":"2026-07-27"}' } }];
    const fetch = fakeFetch({ content: '', tool_calls });
    const tools = [{ type: 'function', function: { name: 'score_contributions', parameters: {} } }];
    const out = await createAiClient({ fetch }).chat([], { tools });
    expect(fetch.body.tools).toEqual(tools);
    expect(out.toolCalls).toEqual([{ id: 'call_1', name: 'score_contributions', arguments: '{"since":"2026-07-27"}' }]);
    expect(out.message).toEqual({ role: 'assistant', content: '', tool_calls });
  });

  test('AI completeJSON asks for JSON with thinking off and parses fenced output', async () => {
    const fetch = fakeFetch({ content: '```json\n{"a": 1}\n```' });
    expect(await createAiClient({ fetch }).completeJSON([])).toEqual({ a: 1 });
    expect(fetch.body).toMatchObject({ response_format: { type: 'json_object' }, reasoning_effort: 'none', temperature: 0 });
  });

  test('AI completeJSON throws AIOutputError on text that is not JSON', async () => {
    const fetch = fakeFetch({ content: 'Sure! Here are the labels.' });
    await expect(createAiClient({ fetch }).completeJSON([])).rejects.toThrow(AIOutputError);
  });

  test('AI parseJSON finds the object inside extra text', () => {
    expect(parseJSON('Here you go: {"ok": true} hope that helps')).toEqual({ ok: true });
  });

  test('AI Ollama not running gives AIUnavailableError', async () => {
    const fetch = async () => { throw new TypeError('fetch failed'); };
    await expect(createAiClient({ fetch }).chat([])).rejects.toThrow(AIUnavailableError);
  });

  test('AI model not pulled (404) gives AIUnavailableError', async () => {
    const fetch = fakeFetch(null, { status: 404 });
    await expect(createAiClient({ fetch }).chat([])).rejects.toThrow(/404/);
  });

  test('AI a reply with no message gives AIUnavailableError', async () => {
    const fetch = fakeFetch(undefined);
    await expect(createAiClient({ fetch }).chat([])).rejects.toThrow(AIUnavailableError);
  });
});
