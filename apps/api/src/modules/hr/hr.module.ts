import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { LeaveController } from './leave.controller';

@Module({
  controllers: [EmployeesController, LeaveController],
})
export class HrModule {}
