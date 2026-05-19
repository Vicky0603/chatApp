import { DepartmentInfoService } from '../src/tools/department-info.service';
import { LlmService } from '../src/llm/llm.service';

const encoder = new TextEncoder();

function createJsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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
    process.env.LLM_MODEL = 'gemini-2.0-flash';
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
        createJsonResponse({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'READY' }] } }],
        }),
      )
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
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody.contents).toEqual([
      { role: 'user', parts: [{ text: 'What is tuition?' }] },
      { role: 'user', parts: [{ text: 'What are the admissions deadlines?' }] },
    ]);
  });

  it('forwards streamed token chunks', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        createJsonResponse({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'READY' }] } }],
        }),
      )
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

  it('executes the tool-call loop before streaming', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        createJsonResponse({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'get_department_info',
                      args: { department: 'Computer Science' },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'READY' }] } }],
        }),
      )
      .mockResolvedValueOnce(
        createSseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"Contact Dr. Elena Park."}]},"finishReason":"STOP"}]}\n\n',
        ]),
      );

    const service = new LlmService(new DepartmentInfoService());
    const tokens: string[] = [];

    for await (const token of service.streamReply({
      history: [],
      newMessage: 'Which department office should I contact for computer science?',
    })) {
      tokens.push(token);
    }

    expect(tokens.join('')).toContain('Elena Park');
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondBody.contents).toEqual(
      expect.arrayContaining([
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'get_department_info',
                args: { department: 'Computer Science' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_department_info',
                response: {
                  content: expect.objectContaining({
                    email: 'cs-office@northwind.edu',
                  }),
                },
              },
            },
          ],
        },
      ]),
    );
  });
});

