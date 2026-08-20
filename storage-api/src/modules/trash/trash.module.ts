import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { FoldersModule } from '../folders/folders.module';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';
import { TrashSweeper } from './trash.sweeper';

@Module({
  imports: [FoldersModule, FilesModule],
  controllers: [TrashController],
  providers: [TrashService, TrashSweeper],
})
export class TrashModule {}
