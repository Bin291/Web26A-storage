import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  async list(@CurrentUser('id') userId: string, @Query('unread') unread?: string) {
    const items = await this.notifications.list(userId, unread === 'true');
    const unreadCount = await this.notifications.countUnread(userId);
    return { items, unreadCount };
  }

  @Patch(':id/read')
  markRead(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  async markAllRead(@CurrentUser('id') userId: string) {
    await this.notifications.markAllRead(userId);
    return { success: true };
  }
}
