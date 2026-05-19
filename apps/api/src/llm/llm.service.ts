import { Injectable } from '@nestjs/common';
import { ServiceError } from '../common/service-error';
import { DepartmentInfoService } from '../tools/department-info.service';
import { Turn } from '../common/chat.types';

interface LlmInput {
  history: Turn[];
  newMessage: string;
}

interface GeminiContentPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
}

interface GeminiCandidate {
  content?: {
    parts?: GeminiContentPart[];
  };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface ToolResolutionResult {
  contents: GeminiContent[];
  refusalText?: string;
}

@Injectable()
export class LlmService {
  private readonly apiKey = process.env.LLM_API_KEY ?? '';
  private readonly model = process.env.LLM_MODEL ?? 'gemini-2.0-flash';
  private readonly apiBase = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(private readonly departmentInfoService: DepartmentInfoService) {}

  async *streamReply(input: LlmInput): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
    }

    if (!this.isAllowedTopic(input.newMessage)) {
      yield* this.chunkText(
        'I can only help with Northwind University topics such as admissions, departments, housing, academics, and campus services.',
      );
      return;
    }

    const prepared = await this.resolveTools(input);
    if (prepared.refusalText) {
      yield* this.chunkText(prepared.refusalText);
      return;
    }

    const streamResponse = await this.fetchJsonOrStream(
      `${this.apiBase}/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        contents: prepared.contents,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_department_info',
                description:
                  'Look up Northwind University department contact information.',
                parameters: {
                  type: 'OBJECT',
                  properties: {
                    department: {
                      type: 'STRING',
                      description: 'Department name, for example Computer Science',
                    },
                  },
                  required: ['department'],
                },
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: { mode: 'NONE' },
        },
        systemInstruction: {
          parts: [
            {
              text:
                'You are the Northwind University support assistant. Answer only about university topics, and keep answers concise, accurate, and practical.',
            },
          ],
        },
        generationConfig: {
          temperature: 0.3,
        },
      },
    );

    if (!streamResponse.body) {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let finalFinishReason = 'STOP';

    for await (const chunk of this.readStream(streamResponse.body)) {
      buffer += decoder.decode(chunk, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        const line = event
          .split('\n')
          .find((candidateLine) => candidateLine.startsWith('data: '));

        if (!line) {
          continue;
        }

        const payload = JSON.parse(line.slice(6)) as GeminiResponse;
        const candidate = payload.candidates?.[0];
        finalFinishReason = candidate?.finishReason ?? finalFinishReason;

        for (const part of candidate?.content?.parts ?? []) {
          if (part.text) {
            yield part.text;
          }
        }
      }
    }

    if (finalFinishReason !== 'STOP') {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
    }
  }

  private async resolveTools(input: LlmInput): Promise<ToolResolutionResult> {
    const contents = this.buildConversation(input.history, input.newMessage);

    for (let step = 0; step < 4; step += 1) {
      const response = await this.fetchJsonOrStream(
        `${this.apiBase}/${this.model}:generateContent?key=${this.apiKey}`,
        {
          contents,
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'get_department_info',
                  description:
                    'Look up Northwind University department contact information.',
                  parameters: {
                    type: 'OBJECT',
                    properties: {
                      department: {
                        type: 'STRING',
                        description: 'Department name, for example Computer Science',
                      },
                    },
                    required: ['department'],
                  },
                },
              ],
            },
          ],
          systemInstruction: {
            parts: [
              {
                text:
                  'You are preparing a Northwind University assistant response. University-related questions — including admissions, applying, enrolling, deadlines, requirements, academics, housing, scholarships, campus services, and departments — are always on-topic. Reply REFUSE only if the question is completely unrelated to university life (e.g., cooking, sports scores, entertainment). Reply READY if you can answer without extra context. Call get_department_info if the user needs department contact details. Do not answer the user yet.',
              },
            ],
          },
          generationConfig: {
            temperature: 0,
          },
        },
      );

      const payload = (await response.json()) as GeminiResponse;
      const candidate = payload.candidates?.[0];
      if (!candidate || candidate.finishReason !== 'STOP') {
        throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
      }

      const parts = candidate.content?.parts ?? [];
      const functionCall = parts.find((part) => part.functionCall)?.functionCall;
      if (functionCall) {
        const result = this.runTool(functionCall.name, functionCall.args);
        contents.push({
          role: 'model',
          parts: [{ functionCall }],
        });
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: functionCall.name,
                response: result,
              },
            },
          ],
        });
        continue;
      }

      const text = parts
        .map((part) => part.text ?? '')
        .join('')
        .trim()
        .toUpperCase();

      if (text === 'REFUSE') {
        return {
          contents,
          refusalText:
            'I can only help with Northwind University topics such as admissions, departments, housing, academics, and campus services.',
        };
      }

      return { contents };
    }

    throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
  }

  private runTool(name: string, args: Record<string, unknown>) {
    if (name !== 'get_department_info') {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
    }

    return {
      content: this.departmentInfoService.getDepartmentInfo(String(args.department ?? '')),
    };
  }

  private buildConversation(history: Turn[], newMessage: string): GeminiContent[] {
    const contents: GeminiContent[] = history.map((turn) => ({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.content }],
    }));

    contents.push({
      role: 'user',
      parts: [{ text: newMessage }],
    });

    return contents;
  }

  private isAllowedTopic(message: string): boolean {
    const normalized = message.toLowerCase();
    return [
      'northwind',
      'university',
      'admission',
      'apply',
      'application',
      'enroll',
      'enrollment',
      'deadline',
      'requirement',
      'department',
      'course',
      'class',
      'program',
      'degree',
      'graduate',
      'undergraduate',
      'transfer',
      'housing',
      'dorm',
      'campus',
      'scholarship',
      'financial aid',
      'registrar',
      'student',
      'faculty',
      'office',
      'major',
      'minor',
      'academic',
      'tuition',
      'gpa',
    ].some((keyword) => normalized.includes(keyword));
  }

  private async fetchJsonOrStream(url: string, body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable', error);
    }

    if (!response.ok) {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable', {
        status: response.status,
      });
    }

    return response;
  }

  private async *readStream(
    stream: ReadableStream<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    const reader = stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }

        if (value) {
          yield value;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async *chunkText(text: string): AsyncIterable<string> {
    for (const word of text.split(' ')) {
      yield `${word} `;
    }
  }
}
