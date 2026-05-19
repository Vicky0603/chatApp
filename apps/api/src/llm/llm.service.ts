import { Injectable, Logger } from '@nestjs/common';
import { ServiceError } from '../common/service-error';
import { DepartmentInfoService } from '../tools/department-info.service';
import { Turn } from '../common/chat.types';

interface LlmInput {
  history: Turn[];
  newMessage: string;
}

interface GeminiContentPart {
  text?: string;
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

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey = process.env.LLM_API_KEY ?? '';
  private readonly model = process.env.LLM_MODEL ?? 'gemini-2.0-flash';
  private readonly apiBase = 'https://generativelanguage.googleapis.com/v1beta/models';

  constructor(private readonly departmentInfoService: DepartmentInfoService) {}

  async *streamReply(input: LlmInput): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
    }

    const contents = this.buildConversation(input.history, input.newMessage);
    const systemText = this.buildSystemPrompt();

    this.logger.log('streamGenerateContent: start');
    const streamResponse = await this.post(
      `${this.apiBase}/${this.model}:generateContent?alt=sse&key=${this.apiKey}`,
      {
        contents,
        systemInstruction: {
          parts: [{ text: systemText }],
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

    this.logger.log(`streamGenerateContent: done — finishReason=${finalFinishReason}`);
    if (finalFinishReason !== 'STOP') {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable');
    }
  }

  private buildSystemPrompt(): string {
    const departments = ['computer science', 'admissions', 'housing'].map((key) => {
      const d = this.departmentInfoService.getDepartmentInfo(key);
      return `${d.department}: contact ${d.contact}, email ${d.email}, office ${d.office}, hours ${d.hours}`;
    });

    return [
      'You are the Northwind University support assistant. Answer only questions related to Northwind University — admissions, academics, housing, departments, campus services, scholarships, and student life.',
      'If a question is completely unrelated to university life, politely decline and redirect.',
      'Keep answers concise, accurate, and practical.',
      '',
      'Department contacts:',
      ...departments,
    ].join('\n');
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

  private async post(url: string, body: unknown): Promise<Response> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
    } catch (error) {
      throw new ServiceError('LLM_UNAVAILABLE', 'LLM unavailable', error);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      this.logger.error(`Gemini returned HTTP ${response.status}`);
      if (response.status === 429) {
        throw new ServiceError('LLM_RATE_LIMITED', 'Rate limit exceeded');
      }
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
}
