import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CommandReasonDto } from '../../common/dto/command-reason.dto';
import { CurrentAdmin } from '../auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AdminPrincipal } from '../auth/admin-principal.interface';
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
    @Req() req: Request,
  ): Promise<PaginatedResponse<PaymentRow>> {
    return this.payments.list(filters, req.correlationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single payment by payment_id.' })
  findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<PaymentRow> {
    return this.payments.findOne(id, req.correlationId);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @RequirePermissions('payments.refund')
  @ApiOperation({
    summary: 'Refund a payment — forwarded to core-api, not a local write.',
  })
  refund(
    @Param('id') id: string,
    @Body() dto: CommandReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.payments.refund(id, admin, dto.reason, req.correlationId);
  }
}
