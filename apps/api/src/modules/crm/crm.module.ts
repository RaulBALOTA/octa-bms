import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module';
import { ActivitiesController } from './activities.controller';
import { ContactsController } from './contacts.controller';
import { PartnersController } from './partners.controller';
import { PartnersService } from './partners.service';

@Module({
  imports: [MasterDataModule],
  controllers: [PartnersController, ContactsController, ActivitiesController],
  providers: [PartnersService],
})
export class CrmModule {}
