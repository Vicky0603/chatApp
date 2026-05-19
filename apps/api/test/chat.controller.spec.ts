import { HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ChatController } from '../src/chat/chat.controller';
import { ChatModule } from '../src/chat/chat.module';
import { LlmService } from '../src/llm/llm.service';
import { SessionService } from '../src/sessions/session.service';
import { KeyValueStore } from '../src/storage/key-value-store';
import { StreamStateService } from '../src/streams/stream-state.service';
import { FakeKeyValueStore } from './helpers/fake-key-value-store';

function createMockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

describe('ChatController', () => {
  let controller: ChatController;
  let sessionService: SessionService;
  let streamStateService: StreamStateService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ChatModule],
    })
      .overrideProvider(KeyValueStore)
      .useValue(new FakeKeyValueStore())
      .overrideProvider(LlmService)
      .useValue({
        async *streamReply() {
          yield 'Hello ';
          yield 'student';
        },
      })
      .compile();

    controller = moduleRef.get(ChatController);
    sessionService = moduleRef.get(SessionService);
    streamStateService = moduleRef.get(StreamStateService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POST /chat/session returns 201-style payload with a session id', async () => {
    const response = await controller.createSession();
    expect(response.sessionId).toBeDefined();
  });

  it('returns 404 for an unknown session id', async () => {
    const res = createMockResponse();

    await controller.postMessage(
      'missing',
      { message: 'Hello university' },
      { header: jest.fn(), on: jest.fn() } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session not found' });
  });

  it('returns 410 for an idle-expired session id', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    const { sessionId } = await controller.createSession();
    await controller.getSession(sessionId);
    nowSpy.mockReturnValue(1_000 + 30 * 60 * 1000 + 1);

    const res = createMockResponse();
    await controller.postMessage(
      sessionId,
      { message: 'Hello university' },
      { header: jest.fn(), on: jest.fn() } as never,
      res as never,
    );

    expect(res.status).toHaveBeenCalledWith(HttpStatus.GONE);
    expect(res.json).toHaveBeenCalledWith({ error: 'Session expired' });
    nowSpy.mockRestore();
  });

  it('returns SSE with the correct content type and done event', async () => {
    const { sessionId } = await controller.createSession();
    const res = createMockResponse();

    await controller.postMessage(
      sessionId,
      { message: 'Tell me about campus housing.' },
      { header: jest.fn(), on: jest.fn((_, callback) => callback()) } as never,
      res as never,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(res.write).toHaveBeenCalledWith('data: {"token":"Hello "}\n\n');
    expect(res.write).toHaveBeenCalledWith('data: {"token":"student"}\n\n');
    expect(res.write).toHaveBeenCalledWith(
      'data: {"done":true,"turnIndex":1}\n\n',
    );
    expect(res.end).toHaveBeenCalled();
  });

  it('stores the completed assistant reply only after the stream finishes', async () => {
    const { sessionId } = await controller.createSession();
    const res = createMockResponse();

    await controller.postMessage(
      sessionId,
      { message: 'Tell me about campus housing.' },
      { header: jest.fn(), on: jest.fn() } as never,
      res as never,
    );

    await expect(sessionService.listTurns(sessionId)).resolves.toEqual([
      { role: 'user', content: 'Tell me about campus housing.' },
      { role: 'assistant', content: 'Hello student' },
    ]);
  });

  it('emits an SSE error event when the LLM fails mid-stream and does not store an assistant turn', async () => {
    const failingModule = await Test.createTestingModule({
      imports: [ChatModule],
    })
      .overrideProvider(KeyValueStore)
      .useValue(new FakeKeyValueStore())
      .overrideProvider(LlmService)
      .useValue({
        async *streamReply() {
          yield 'Partial ';
          throw new Error('upstream failed');
        },
      })
      .compile();

    const failingController = failingModule.get(ChatController);
    const failingSessionService = failingModule.get(SessionService);
    const { sessionId } = await failingController.createSession();
    const res = createMockResponse();

    await failingController.postMessage(
      sessionId,
      { message: 'Tell me about campus housing.' },
      { header: jest.fn(), on: jest.fn() } as never,
      res as never,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream',
    );
    expect(res.write).toHaveBeenCalledWith('data: {"token":"Partial "}\n\n');
    expect(res.write).toHaveBeenCalledWith(
      'data: {"error":"LLM unavailable"}\n\n',
    );
    expect(res.write).not.toHaveBeenCalledWith(
      'data: {"done":true,"turnIndex":1}\n\n',
    );
    await expect(failingSessionService.listTurns(sessionId)).resolves.toEqual([
      { role: 'user', content: 'Tell me about campus housing.' },
    ]);
  });

  it('resumes a dropped stream from Last-Event-ID', async () => {
    const { sessionId } = await controller.createSession();
    await streamStateService.create(sessionId, 'Tell me about campus housing.');
    await streamStateService.appendToken(sessionId, 'Hello ');
    await streamStateService.appendToken(sessionId, 'student');
    await streamStateService.complete(sessionId, 1);

    const res = createMockResponse();
    await controller.postMessage(
      sessionId,
      { message: 'Tell me about campus housing.' },
      {
        header: jest.fn().mockReturnValue('0'),
        on: jest.fn(),
      } as never,
      res as never,
    );

    expect(res.write).toHaveBeenCalledWith('id: 1\ndata: {"token":"student"}\n\n');
    expect(res.write).toHaveBeenCalledWith(
      'data: {"done":true,"turnIndex":1}\n\n',
    );
  });
});
