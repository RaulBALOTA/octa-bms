import {
  Body,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
} from 'class-validator';
import { CompanyId, RequirePermission } from '../../core/auth/decorators';
import { PrismaService } from '../../core/prisma/prisma.service';
import { OrgChartService } from './org-chart.service';

const APPLICANT_STAGES = [
  'NEW',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
] as const;

/** German GDPR practice: applicant data is deleted 6 months after rejection. */
const GDPR_RETENTION_DAYS = 183;

class CreateOpeningDto {
  @IsString() title!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() officeId?: string;
  @IsOptional() @IsString() departmentName?: string;
  @IsOptional() @IsString() officeName?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsDateString() targetStartDate?: string;
}

class CreateApplicantDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsNumberString() expectedSalary?: string;
  @IsOptional() @IsDateString() availableFrom?: string;
  @IsOptional() @IsString() notes?: string;
}

class StageDto {
  @IsIn([...APPLICANT_STAGES]) stage!: string;
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class RecruitmentController {
  constructor(private readonly prisma: PrismaService, private readonly chart: OrgChartService) {}

  @Get('recruitment/open-positions')
  @RequirePermission('hr.recruitment.read')
  async openPositions(@CompanyId() companyId: string) {
    return (await this.chart.positions(companyId)).filter((position) => position.status === 'OPEN');
  }

  // ------------------------------------------------------------ job openings

  @Get('job-openings')
  @RequirePermission('hr.recruitment.read')
  openings(@CompanyId() companyId: string) {
    return this.prisma.jobOpening.findMany({
      where: { companyId, deletedAt: null },
      include: { department: { select: { id: true, name: true } }, office: { select: { id: true, name: true } }, _count: { select: { applicants: { where: { deletedAt: null } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('job-openings')
  @RequirePermission('hr.recruitment.create')
  async createOpening(@CompanyId() companyId: string, @Body() dto: CreateOpeningDto) {
    const [department, office] = await Promise.all([
      dto.departmentId || dto.departmentName ? this.prisma.department.findFirst({ where: { companyId, deletedAt: null, isActive: true,
        ...(dto.departmentId ? { id: dto.departmentId } : { name: dto.departmentName }) }, select: { id: true, name: true } }) : null,
      dto.officeId || dto.officeName ? this.prisma.office.findFirst({ where: { companyId, deletedAt: null, isActive: true,
        ...(dto.officeId ? { id: dto.officeId } : { name: dto.officeName }) }, select: { id: true, name: true } }) : null,
    ]);
    if ((dto.departmentId || dto.departmentName) && !department) throw new BadRequestException('Department not found in this company');
    if ((dto.officeId || dto.officeName) && !office) throw new BadRequestException('Office not found in this company');
    return this.prisma.jobOpening.create({
      data: {
        companyId,
        title: dto.title,
        departmentId: department?.id,
        officeId: office?.id,
        departmentName: department?.name,
        officeName: office?.name,
        description: dto.description,
        targetStartDate: dto.targetStartDate
          ? new Date(dto.targetStartDate)
          : undefined,
        publishedAt: new Date(),
      },
    });
  }

  @Patch('job-openings/:id/status')
  @RequirePermission('hr.recruitment.update')
  async updateOpeningStatus(
    @CompanyId() companyId: string,
    @Param('id') id: string,
    @Body() body: { status: 'DRAFT' | 'OPEN' | 'ON_HOLD' | 'FILLED' | 'CANCELLED' },
  ) {
    if (!['DRAFT', 'OPEN', 'ON_HOLD', 'FILLED', 'CANCELLED'].includes(body.status)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'Invalid opening status',
      });
    }
    const opening = await this.prisma.jobOpening.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!opening) throw new NotFoundException('Job opening not found');
    return this.prisma.jobOpening.update({
      where: { id },
      data: { status: body.status },
    });
  }

  // -------------------------------------------------------------- applicants

  /** Applicants across all openings, grouped by pipeline stage (kanban feed). */
  @Get('applicants/board')
  @RequirePermission('hr.recruitment.read')
  async board(@CompanyId() companyId: string) {
    const applicants = await this.prisma.applicant.findMany({
      where: { deletedAt: null, stage: { notIn: ['WITHDRAWN'] }, jobOpening: { companyId, deletedAt: null } },
      include: {
        jobOpening: { select: { id: true, title: true } },
        interviews: { select: { id: true, scheduledAt: true, result: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return APPLICANT_STAGES.filter((stage) => stage !== 'WITHDRAWN').map(
      (stage) => ({
        stage,
        items: applicants.filter((applicant) => applicant.stage === stage),
      }),
    );
  }

  @Post('job-openings/:id/applicants')
  @RequirePermission('hr.recruitment.create')
  async addApplicant(
    @CompanyId() companyId: string,
    @Param('id') jobOpeningId: string,
    @Body() dto: CreateApplicantDto,
  ) {
    const opening = await this.prisma.jobOpening.findFirst({
      where: { id: jobOpeningId, companyId, deletedAt: null },
    });
    if (!opening) throw new NotFoundException('Job opening not found');
    return this.prisma.applicant.create({
      data: {
        jobOpeningId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        source: dto.source,
        expectedSalary: dto.expectedSalary,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : undefined,
        notes: dto.notes,
        gdprConsentDate: new Date(),
      },
    });
  }

  @Post('applicants/:id/stage')
  @RequirePermission('hr.recruitment.update')
  async setStage(@CompanyId() companyId: string, @Param('id') id: string, @Body() dto: StageDto) {
    const applicant = await this.prisma.applicant.findFirst({
      where: { id, deletedAt: null, jobOpening: { companyId, deletedAt: null } },
    });
    if (!applicant) throw new NotFoundException('Applicant not found');
    if (['HIRED', 'REJECTED'].includes(applicant.stage)) {
      throw new UnprocessableEntityException({
        code: 'APPLICANT_CLOSED',
        message: `Applicant is already ${applicant.stage}`,
      });
    }
    return this.prisma.applicant.update({
      where: { id },
      data: {
        stage: dto.stage,
        // GDPR clock starts on rejection; cleared again if reopened later
        gdprDeleteBy:
          dto.stage === 'REJECTED'
            ? new Date(Date.now() + GDPR_RETENTION_DAYS * 86_400_000)
            : null,
      },
    });
  }
}
