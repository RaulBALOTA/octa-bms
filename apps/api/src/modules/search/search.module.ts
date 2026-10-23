import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchIndexService } from './search-index.service';

@Module({
  controllers: [SearchController],
  providers: [SearchIndexService],
  exports: [SearchIndexService],
})
export class SearchModule {}
