import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { requireInCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';

class UpsertContactDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsOptional() @IsString() salutation?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() position?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() notes?: string;
}

class UpdateContactDto extends UpsertContactDto {
  @IsOptional() @IsString() declare firstName: string;
  @IsOptional() @IsString() declare lastName: string;
}

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class ContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('partners/:partnerId/contacts')
  @RequirePermission('crm.contacts.create')
  async create(
    @CompanyId() companyId: string,
    @Param('partnerId') partnerId: string,
    @Body() dto: UpsertContactDto,
  ) {
    await requireInCompany(
      this.prisma.businessPartner.findFirst({
        where: { id: partnerId, companyId, deletedAt: null },
        select: { id: true },
      }),
      'Partner',
    );
    if (dto.isPrimary) {
      await this.prisma.contact.updateMany({
        where: { partnerId },
        data: { isPrimary: false },
      });
    }
    return this.prisma.contact.create({ data: { ...dto, partnerId } });
  }

  @Patch('contacts/:id')
  @RequirePermission('crm.contacts.update')
  async update(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    const contact = await this.findContact(companyId, id);
    if (dto.isPrimary) {
      await this.prisma.contact.updateMany({
        where: { partnerId: contact.partnerId },
        data: { isPrimary: false },
      });
    }
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  @Delete('contacts/:id')
  @RequirePermission('crm.contacts.delete')
  @HttpCode(204)
  async remove(@CompanyId() companyId: string, @Param('id') id: string) {
    await this.findContact(companyId, id);
    await this.prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private findContact(companyId: string, id: string) {
    return requireInCompany(
      this.prisma.contact.findFirst({
        where: { id, deletedAt: null, partner: { companyId, deletedAt: null } },
      }),
      'Contact',
    );
  }
}
