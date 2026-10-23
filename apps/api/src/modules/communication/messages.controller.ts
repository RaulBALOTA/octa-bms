import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import {
  AuthUser,
  CurrentUser,
  RequirePermission,
} from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

class SendMessageDto {
  @IsString() recipientId!: string;
  @IsString() @MaxLength(4000) body!: string;
}

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
} as const;

/** Message Center: internal 1:1 messages between BMS users. */
@ApiTags('communication')
@ApiBearerAuth()
@Controller('communication/messages')
export class MessagesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Conversation list: one row per counterpart with last message + unread. */
  @Get()
  @RequirePermission('communication.messages.read')
  async conversations(@CurrentUser() user: AuthUser) {
    const messages = await this.prisma.directMessage.findMany({
      where: { OR: [{ senderId: user.id }, { recipientId: user.id }] },
      include: {
        sender: { select: USER_SELECT },
        recipient: { select: USER_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const byCounterpart = new Map<
      string,
      {
        user: { id: string; firstName: string; lastName: string };
        lastMessage: string;
        lastAt: Date;
        unread: number;
      }
    >();
    for (const message of messages) {
      const counterpart =
        message.senderId === user.id ? message.recipient : message.sender;
      const entry = byCounterpart.get(counterpart.id);
      if (!entry) {
        byCounterpart.set(counterpart.id, {
          user: counterpart,
          lastMessage: message.body,
          lastAt: message.createdAt,
          unread:
            message.recipientId === user.id && !message.readAt ? 1 : 0,
        });
      } else if (message.recipientId === user.id && !message.readAt) {
        entry.unread += 1;
      }
    }
    return [...byCounterpart.values()];
  }

  /** Thread with one user; opening it marks incoming messages as read. */
  @Get(':userId')
  @RequirePermission('communication.messages.read')
  async thread(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    const messages = await this.prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: user.id, recipientId: userId },
          { senderId: userId, recipientId: user.id },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    await this.prisma.directMessage.updateMany({
      where: { senderId: userId, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return messages;
  }

  @Post()
  @RequirePermission('communication.messages.create')
  async send(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto) {
    if (dto.recipientId === user.id) {
      throw new UnprocessableEntityException({
        code: 'SELF_MESSAGE',
        message: 'Cannot message yourself',
      });
    }
    const recipient = await this.prisma.user.findFirst({
      where: { id: dto.recipientId, deletedAt: null, isActive: true },
    });
    if (!recipient) {
      throw new UnprocessableEntityException({
        code: 'RECIPIENT_NOT_FOUND',
        message: 'Recipient not found or inactive',
      });
    }
    const message = await this.prisma.directMessage.create({
      data: { senderId: user.id, recipientId: dto.recipientId, body: dto.body },
    });
    const sender = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    });
    await this.notifications.notify({
      userIds: [dto.recipientId],
      type: 'MENTION',
      title: `💬 ${sender?.firstName} ${sender?.lastName}`,
      body: dto.body.slice(0, 120),
      link: '/communication',
    });
    return message;
  }
}
