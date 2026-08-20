import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { NotificationModule } from '../notification/notification.module';
import { ShareController } from './share.controller';
import { SharedWithMeController } from './shared-with-me.controller';
import { PublicShareController } from './public-share.controller';
import { ShareService } from './share.service';

@Module({
  imports: [FilesModule, FoldersModule, NotificationModule],
  controllers: [ShareController, SharedWithMeController, PublicShareController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
