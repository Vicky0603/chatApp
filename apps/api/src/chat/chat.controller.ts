import {
  Body,
  Controller,
  Delete,
  GoneException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ChatStreamService } from './chat-stream.service';
import { SessionService } from '../sessions/session.service';
import { MessageDto } from './dto/message.dto';
import type { Request } from 'express';

@Controller()
export class ChatController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly chatStreamService: ChatStreamService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async createSession() {
    const session = await this.sessionService.create();
    return { sessionId: session.id };
  }

  @Delete('session/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('sessionId') sessionId: string) {
    await this.sessionService.delete(sessionId);
  }

  @Get('chat/:sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return {
      turns: await this.sessionService.listTurns(sessionId),
    };
  }

  @Post('chat/:sessionId/message')
  async postMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: MessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const message = body.message?.trim();
    if (!message) {
      res.status(HttpStatus.BAD_REQUEST).json({ error: 'Message is required' });
      return;
    }
    try {
      await this.chatStreamService.handleMessage(sessionId, message, req, res);
    } catch (error) {
      if (error instanceof NotFoundException) {
        res.status(HttpStatus.NOT_FOUND).json({ error: 'Session not found' });
        return;
      }

      if (error instanceof GoneException) {
        res.status(HttpStatus.GONE).json({ error: 'Session expired' });
        return;
      }

      throw error;
    }
  }
}
