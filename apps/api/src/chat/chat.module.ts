import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { SessionService } from '../sessions/session.service';
import { LlmService } from '../llm/llm.service';
import { DepartmentInfoService } from '../tools/department-info.service';
import { KeyValueStore } from '../storage/key-value-store';
import { RedisStoreService } from '../storage/redis-store.service';
import { StreamStateService } from '../streams/stream-state.service';

@Module({
  controllers: [ChatController],
  providers: [
    {
      provide: KeyValueStore,
      useClass: RedisStoreService,
    },
    SessionService,
    StreamStateService,
    LlmService,
    DepartmentInfoService,
  ],
})
export class ChatModule {}
