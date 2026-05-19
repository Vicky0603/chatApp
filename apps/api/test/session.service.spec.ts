import { GoneException, NotFoundException } from '@nestjs/common';
import { SessionService } from '../src/sessions/session.service';
import { FakeKeyValueStore } from './helpers/fake-key-value-store';

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    service = new SessionService(new FakeKeyValueStore());
  });

  it('creates a session', async () => {
    const session = await service.create();
    expect(session.id).toBeDefined();
    await expect(service.listTurns(session.id)).resolves.toEqual([]);
  });

  it('retrieves turns', async () => {
    const session = await service.create();
    await service.appendUserTurn(session.id, 'hello');
    await service.appendAssistantTurn(session.id, 'hi');
    await expect(service.listTurns(session.id)).resolves.toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  it('expires after 30 minutes', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    const session = await service.create();
    nowSpy.mockReturnValue(1_000 + 30 * 60 * 1000 + 1);

    await expect(service.listTurns(session.id)).rejects.toThrow(GoneException);
    nowSpy.mockRestore();
  });

  it('deletes sessions', async () => {
    const session = await service.create();
    await service.delete(session.id);
    await expect(service.listTurns(session.id)).rejects.toThrow(NotFoundException);
  });
});
