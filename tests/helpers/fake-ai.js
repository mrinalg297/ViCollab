// Stand-in for the client from src/ai.js, so no test needs a running model.
// Each call takes the next scripted reply: a value, a function (messages, options) => value,
// or an Error to throw. Every call is recorded in .calls for assertions.
const { AIUnavailableError, AIOutputError } = require('../../src/ai');

function fakeAI({ chat = [], json = [] } = {}) {
  const calls = { chat: [], json: [] };
  const next = (queue, kind, messages, options) => {
    calls[kind].push({ messages: JSON.parse(JSON.stringify(messages)), options });
    if (!queue.length) throw new Error(`fake AI: no ${kind} reply left`);
    let reply = queue.shift();
    if (typeof reply === 'function') reply = reply(messages, options);
    if (reply instanceof Error) throw reply;
    // streaming callers get the text word by word, like Ollama sends it
    if (options && options.onDelta && reply.content) reply.content.split(/(?=\s)/).forEach((t) => options.onDelta(t));
    return reply;
  };
  return {
    model: 'fake-model',
    calls,
    chat: async (messages, options) => next(chat, 'chat', messages, options),
    completeJSON: async (messages, options) => next(json, 'json', messages, options),
  };
}

// helpers for scripting chat replies
const say = (content) => ({ content, toolCalls: [], message: { role: 'assistant', content } });
const callTool = (name, args, id = 'c1') => ({
  content: '',
  toolCalls: [{ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }],
  message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
});
const down = () => new AIUnavailableError('connect ECONNREFUSED 127.0.0.1:11434');
const notJson = () => new AIOutputError('reply was not valid JSON');

module.exports = { fakeAI, say, callTool, down, notJson };
