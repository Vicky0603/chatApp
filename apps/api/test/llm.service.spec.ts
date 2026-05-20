import { DepartmentInfoService } from '../src/tools/department-info.service';
import { LlmService } from '../src/llm/llm.service';

const encoder = new TextEncoder();

function createSseResponse(chunks: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );
}

describe('LlmService', () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousModel = process.env.LLM_MODEL;

  beforeEach(() => {
    process.env.LLM_API_KEY = 'test-key';
    process.env.LLM_MODEL = 'gemini-2.5-flash';
  });

  afterEach(() => {
    process.env.LLM_API_KEY = previousKey;
    process.env.LLM_MODEL = previousModel;
    jest.restoreAllMocks();
  });

  it('passes history and the new message correctly', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        createSseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}]}\n\n',
        ]),
      );

    const service = new LlmService(new DepartmentInfoService());
    const tokens: string[] = [];

    for await (const token of service.streamReply({
      history: [{ role: 'user', content: 'What is tuition?' }],
      newMessage: 'What are the admissions deadlines?',
    })) {
      tokens.push(token);
    }

    expect(tokens.join('')).toBe('Hello');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'What is tuition?' }] },
      { role: 'user', parts: [{ text: 'What are the admissions deadlines?' }] },
    ]);
  });

  it('forwards streamed token chunks', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        createSseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Northwind "}]},"finishReason":"STOP"}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"University"}]},"finishReason":"STOP"}]}\n\n',
        ]),
      );

    const service = new LlmService(new DepartmentInfoService());
    const tokens: string[] = [];

    for await (const token of service.streamReply({
      history: [],
      newMessage: 'Tell me about university housing.',
    })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Northwind ', 'University']);
  });

  it('parses SSE events separated by CRLF line endings', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        createSseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]},"finishReason":"STOP"}]}\r\n\r\ndata: {"candidates":[{"content":{"parts":[{"text":"World"}]},"finishReason":"STOP"}]}\r\n\r\n',
        ]),
      );

    const service = new LlmService(new DepartmentInfoService());
    const tokens: string[] = [];

    for await (const token of service.streamReply({
      history: [],
      newMessage: 'Hi',
    })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Hello ', 'World']);
  });

  it('skips events where the candidate has no content parts', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        createSseResponse([
          'data: {"candidates":[{}]}\n\n',
          'data: {"candidates":[{"content":{"parts":[{"text":"Done."}]},"finishReason":"STOP"}]}\n\n',
        ]),
      );

    const service = new LlmService(new DepartmentInfoService());
    const tokens: string[] = [];

    for await (const token of service.streamReply({
      history: [],
      newMessage: 'Hello',
    })) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['Done.']);
  });
});
