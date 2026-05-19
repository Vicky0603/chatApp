import {
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ServiceError } from '../common/service-error';
import { LlmService } from '../llm/llm.service';
import { SessionService } from '../sessions/session.service';
import { StreamStateService } from '../streams/stream-state.service';

const RESUME_POLL_INTERVAL_MS = 100;
const RESUME_TIMEOUT_MS = 30_000;

@Injectable()
export class ChatStreamService {
  constructor(
    private readonly sessionService: SessionService,
    private readonly streamStateService: StreamStateService,
    private readonly llmService: LlmService,
  ) {}

  async handleMessage(sessionId: string, message: string, req: Request, res: Response) {
    const lastEventId = this.parseLastEventId(req);
    const existingStream = await this.streamStateService.get(sessionId);
    if (lastEventId !== null && existingStream?.userMessage === message) {
      this.prepareSseHeaders(res);
      await this.resumeStream(res, sessionId, lastEventId);
      return;
    }

    let history;
    try {
      history = await this.sessionService.listTurns(sessionId);
      await this.sessionService.appendUserTurn(sessionId, message);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof GoneException) {
        throw error;
      }

      throw error;
    }

    this.prepareSseHeaders(res);
    await this.streamStateService.create(sessionId, message);

    let clientClosed = false;
    req.on('close', () => {
      clientClosed = true;
    });

    let tokenIndex = 0;

    try {
      for await (const token of this.llmService.streamReply({
        history,
        newMessage: message,
      })) {
        await this.streamStateService.appendToken(sessionId, token);
        if (!clientClosed) {
          res.write(this.tokenEvent(tokenIndex, token));
        }
        tokenIndex += 1;
      }

      const streamState = await this.streamStateService.get(sessionId);
      const turnIndex = await this.sessionService.appendAssistantTurn(
        sessionId,
        streamState?.assistantText.trim() ?? '',
      );
      await this.streamStateService.complete(sessionId, turnIndex);
      if (!clientClosed) {
        res.write(`data: ${JSON.stringify({ done: true, turnIndex })}\n\n`);
      }
    } catch (error) {
      const errorMessage = this.clientErrorMessage(error);
      await this.streamStateService.fail(sessionId, errorMessage);
      if (!clientClosed) {
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      }
    } finally {
      if (!clientClosed) {
        res.end();
      }
    }
  }

  private prepareSseHeaders(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  private parseLastEventId(req: Request): number | null {
    const raw = req.header('last-event-id');
    if (!raw) {
      return null;
    }

    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? null : value;
  }

  private tokenEvent(index: number, token: string): string {
    return `id: ${index}\ndata: ${JSON.stringify({ token })}\n\n`;
  }

  private async resumeStream(
    res: Response,
    sessionId: string,
    lastEventId: number,
  ) {
    const startedAt = Date.now();
    let nextIndex = lastEventId + 1;

    while (Date.now() - startedAt < RESUME_TIMEOUT_MS) {
      let state;
      try {
        state = await this.streamStateService.get(sessionId);
      } catch (error) {
        res.write(
          `data: ${JSON.stringify({ error: this.clientErrorMessage(error) })}\n\n`,
        );
        res.end();
        return;
      }
      if (!state) {
        res.write(`data: ${JSON.stringify({ error: 'LLM unavailable' })}\n\n`);
        res.end();
        return;
      }

      while (nextIndex < state.tokens.length) {
        res.write(this.tokenEvent(nextIndex, state.tokens[nextIndex]));
        nextIndex += 1;
      }

      if (state.status === 'done') {
        res.write(
          `data: ${JSON.stringify({
            done: true,
            turnIndex: state.turnIndex,
          })}\n\n`,
        );
        res.end();
        return;
      }

      if (state.status === 'error') {
        res.write(
          `data: ${JSON.stringify({ error: state.error ?? 'LLM unavailable' })}\n\n`,
        );
        res.end();
        return;
      }

      await this.sleep(RESUME_POLL_INTERVAL_MS);
    }

    res.write(`data: ${JSON.stringify({ error: 'LLM unavailable' })}\n\n`);
    res.end();
  }

  private sleep(durationMs: number) {
    return new Promise((resolve) => setTimeout(resolve, durationMs));
  }

  private clientErrorMessage(error: unknown) {
    if (error instanceof ServiceError) {
      if (error.code === 'REDIS_UNAVAILABLE') {
        return 'Session store unavailable';
      }

      if (error.code === 'LLM_UNAVAILABLE') {
        return 'LLM unavailable';
      }
    }

    return 'Internal server error';
  }
}

