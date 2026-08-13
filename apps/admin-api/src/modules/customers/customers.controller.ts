import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { CustomerRow, CustomersService } from './customers.service';
import { ListCustomersDto } from './dto/list-customers.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('customers.view')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers, filtered and cursor-paginated.' })
  list(
    @Query() filters: ListCustomersDto,
    @Req() req: Request,
  ): Promise<PaginatedResponse<CustomerRow>> {
    return this.customers.list(filters, req.correlationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single customer by customer_id, with ride/trip counts.' })
  findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<CustomerRow> {
    return this.customers.findOne(id, req.correlationId);
  }
}
