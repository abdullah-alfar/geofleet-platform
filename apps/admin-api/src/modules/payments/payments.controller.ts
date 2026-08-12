import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListPaymentsDto } from './dto/list-payments.dto';
import { PaymentRow, PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('payments.view')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'List payments, filtered and cursor-paginated.' })
  list(
    @Query() filters: ListPaymentsDto,
  ): Promise<PaginatedResponse<PaymentRow>> {
    return this.payments.list(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single payment by payment_id.' })
  findOne(@Param('id') id: string): Promise<PaymentRow> {
    return this.payments.findOne(id);
  }
}
