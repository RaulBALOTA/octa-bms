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
import { RequirePermission } from '../../core/auth/decorators';
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
    @Param('partnerId') partnerId: string,
    @Body() dto: UpsertContactDto,
  ) {
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
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    if (dto.isPrimary) {
      const contact = await this.prisma.contact.findUniqueOrThrow({
        where: { id },
      });
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
  async remove(@Param('id') id: string) {
    await this.prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
