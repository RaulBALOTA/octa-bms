import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { LeaveController } from './leave.controller';
import { RecruitmentController } from './recruitment.controller';
import { OrgChartController } from './org-chart.controller';
import { OrgChartService } from './org-chart.service';
import { StaffingBudgetController } from './staffing-budget.controller';
import { StaffingBudgetService } from './staffing-budget.service';

@Module({
  controllers: [
    EmployeesController,
    LeaveController,
    RecruitmentController,
    OrgChartController,
    StaffingBudgetController,
  ],
  providers: [OrgChartService, StaffingBudgetService],
})
export class HrModule {}
