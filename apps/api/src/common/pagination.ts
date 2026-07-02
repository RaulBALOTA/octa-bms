import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;

  @ApiPropertyOptional({ description: 'Quick search term' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Sort: comma-separated fields, "-" prefix for desc',
    example: '-createdAt,name',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  get skip(): number {
    return (this.page - 1) * this.pageSize;
  }

  orderBy(allowed: string[]): Record<string, 'asc' | 'desc'>[] {
    if (!this.sort) return [];
    return this.sort
      .split(',')
      .map((raw) => {
        const desc = raw.startsWith('-');
        const field = desc ? raw.slice(1) : raw;
        return allowed.includes(field)
          ? { [field]: desc ? ('desc' as const) : ('asc' as const) }
          : null;
      })
      .filter((x): x is Record<string, 'asc' | 'desc'> => x !== null);
  }
}

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export function paged<T>(
  data: T[],
  total: number,
  query: PageQueryDto,
): Paged<T> {
  return {
    data,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}
