import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AssetStatus, Prisma } from '@prisma/client';
import { assertReferenceInCompany, inCompany } from '../../common/tenant-scope';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paged } from '../../common/pagination';
import { NumberSequenceService } from '../master-data/number-sequence.service';
import { CreateAssetDto, ListAssetsQuery } from './dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequences: NumberSequenceService,
  ) {}

  async list(companyId: string, query: ListAssetsQuery) {
    const where: Prisma.AssetWhereInput = {
      companyId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { assetNumber: { contains: query.q, mode: 'insensitive' } },
              { serialNumber: { contains: query.q, mode: 'insensitive' } },
              { manufacturer: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: {
          category: { select: { id: true, code: true, name: true } },
          assignments: {
            where: { returnedAt: null },
            include: {
              employee: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
        skip: query.skip,
        take: query.pageSize,
        orderBy: { assetNumber: 'asc' },
      }),
      this.prisma.asset.count({ where }),
    ]);
    return paged(data, total, query);
  }

  async get(companyId: string, id: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        category: true,
        assignments: {
          orderBy: { assignedAt: 'desc' },
          include: {
            employee: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        maintenance: { orderBy: { performedAt: 'desc' } },
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async create(companyId: string, userId: string, dto: CreateAssetDto) {
    return this.prisma.$transaction(async (tx) => {
      const assetNumber = await this.sequences.next(tx, companyId, 'asset', 'AST');
      return tx.asset.create({
        data: {
          companyId,
          assetNumber,
          categoryId: dto.categoryId,
          name: dto.name,
          serialNumber: dto.serialNumber,
          manufacturer: dto.manufacturer,
          model: dto.model,
          purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
          purchasePrice: dto.purchasePrice,
          warrantyUntil: dto.warrantyUntil ? new Date(dto.warrantyUntil) : undefined,
          licensePlate: dto.licensePlate,
          location: dto.location,
          notes: dto.notes,
          createdById: userId,
        },
        include: { category: true },
      });
    });
  }

  async assign(companyId: string, id: string, employeeId: string) {
    const asset = await this.get(companyId, id);
    await assertReferenceInCompany(employeeId, 'employeeId', inCompany(this.prisma, 'employee', companyId));
    if (asset.status === 'ASSIGNED') {
      throw new UnprocessableEntityException({
        code: 'ASSET_ALREADY_ASSIGNED',
        message: 'Asset is already assigned — return it first',
      });
    }
    if (asset.status !== 'IN_STOCK') {
      throw new UnprocessableEntityException({
        code: 'ASSET_NOT_AVAILABLE',
        message: `Asset is ${asset.status}`,
      });
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.assetAssignment.create({
        data: { assetId: id, employeeId },
      }),
      this.prisma.asset.update({
        where: { id },
        data: { status: AssetStatus.ASSIGNED },
      }),
    ]);
    return updated;
  }

  async return(companyId: string, id: string) {
    const asset = await this.get(companyId, id);
    if (asset.status !== 'ASSIGNED') {
      throw new UnprocessableEntityException({
        code: 'ASSET_NOT_ASSIGNED',
        message: 'Asset has no open assignment',
      });
    }
    const [, updated] = await this.prisma.$transaction([
      this.prisma.assetAssignment.updateMany({
        where: { assetId: id, returnedAt: null },
        data: { returnedAt: new Date() },
      }),
      this.prisma.asset.update({
        where: { id },
        data: { status: AssetStatus.IN_STOCK },
      }),
    ]);
    return updated;
  }
}
