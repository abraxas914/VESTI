import assert from 'node:assert/strict';
import {
  buildDefaultLlmSettings,
  DEFAULT_PROXY_SERVICE_TOKEN,
} from '../src/lib/services/llmConfig';
import { requestEmbeddings } from '../src/lib/services/embeddingService';
import { callModelScope, callProxyService } from '../src/lib/services/llmService';
import { fetchDemoProxy } from '../src/lib/services/proxyRequest';

type FetchCall = { url: string; init: RequestInit };

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'OK' } }],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'browser-chat-1',
          'x-proxy-provider-used': 'dashscope',
          'x-proxy-model-used': 'qwen-plus',
        },
      });
    };

    const demo = buildDefaultLlmSettings();
    const chat = await callProxyService(demo, 'synthetic browser contract prompt');
    assert.equal(chat.content, 'OK');
    assert.equal(calls[0].url, 'https://api.ccvg1218.online/api/chat');
    assert.equal(
      (calls[0].init.headers as Record<string, string>)['x-vesti-service-token'],
      DEFAULT_PROXY_SERVICE_TOKEN,
    );
    const chatBody = JSON.parse(String(calls[0].init.body));
    assert.equal(chatBody.model, 'qwen-plus');
    assert.equal(chatBody.stream, false);

    calls.length = 0;
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const jsonResult = await callProxyService(demo, 'synthetic JSON repair prompt', {
      responseFormat: 'json_object',
    });
    assert.deepEqual(JSON.parse(jsonResult.content), { ok: true });

    calls.length = 0;
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        data: [{ index: 0, embedding: Array.from({ length: 1536 }, () => 0.01) }],
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-proxy-provider-used': 'dashscope',
          'x-proxy-model-used': 'text-embedding-v1',
        },
      });
    };
    const embedding = await requestEmbeddings(demo, ['synthetic embedding text']);
    assert.equal(calls[0].url, 'https://api.ccvg1218.online/api/embeddings');
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      input: ['synthetic embedding text'],
      encoding_format: 'float',
    });
    assert.equal(embedding.model, 'text-embedding-v1');
    assert.equal(embedding.dimensions, 1536);

    for (const status of [400, 401, 403, 404, 422]) {
      let attempts = 0;
      await fetchDemoProxy({
        primaryBaseUrl: 'https://api.ccvg1218.online/api',
        route: 'chat',
        body: '{}',
      }, async () => {
        attempts += 1;
        return new Response('{}', { status });
      });
      assert.equal(attempts, 1, `HTTP ${status} must not fallback`);
    }

    for (const status of [429, 500, 503]) {
      const bodies: string[] = [];
      const response = await fetchDemoProxy({
        primaryBaseUrl: 'https://api.ccvg1218.online/api',
        route: 'chat',
        body: '{"same":true}',
      }, async (_input, init) => {
        bodies.push(String(init?.body));
        return new Response('{}', { status: bodies.length === 1 ? status : 200 });
      });
      assert.equal(response.status, 200);
      assert.deepEqual(bodies, ['{"same":true}', '{"same":true}']);
    }

    let networkAttempts = 0;
    await fetchDemoProxy({
      primaryBaseUrl: 'https://api.ccvg1218.online/api',
      route: 'chat',
      body: '{}',
    }, async () => {
      networkAttempts += 1;
      if (networkAttempts === 1) throw new TypeError('synthetic network failure');
      return new Response('{}', { status: 200 });
    });
    assert.equal(networkAttempts, 2);

    calls.length = 0;
    globalThis.fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'BYOK OK' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const byok = {
      ...demo,
      mode: 'custom_byok' as const,
      baseUrl: 'https://example.test/v1/',
      apiKey: 'synthetic-byok-key',
      customModelId: 'qwen-plus',
    };
    await callModelScope(byok, 'synthetic BYOK prompt');
    assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
    assert.equal(
      (calls[0].init.headers as Record<string, string>).Authorization,
      'Bearer synthetic-byok-key',
    );

    console.log('Browser proxy contract: 19 assertions passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();
