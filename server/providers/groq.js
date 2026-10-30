const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-20b';
const TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 32 * 1024;

export async function rankWithGroq(context, fetchImpl = fetch) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Classe les options de budget fournies. Ne crée ni ne modifie aucune option. Réponds uniquement en JSON: {"options":[{"candidateId":"identifiant fourni","explanation":"motif bref"}]}. Classe chaque candidateId exactement une fois. Les explications ne doivent ajouter aucun fait financier.',
          },
          { role: 'user', content: JSON.stringify(context) },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await readBoundedJson(response);
    if (!payload) return null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length > 10_000) return null;
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.options)) return null;
    return { options: parsed.options, model: GROQ_MODEL };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytesRead = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}
