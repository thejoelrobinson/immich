import { Controller, Get, Next, Param, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NextFunction, Response } from 'express';
import { AuthDto } from 'src/dtos/auth.dto';
import { OnlyOfficeConfigResponseDto, OnlyOfficeDocumentConfigDto } from 'src/dtos/onlyoffice.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { OnlyOfficeService } from 'src/services/onlyoffice.service';
import { sendFile } from 'src/utils/file';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Assets)
@Controller('onlyoffice')
export class OnlyOfficeController {
  constructor(
    private service: OnlyOfficeService,
    private logger: LoggingRepository,
  ) {}

  /**
   * Get ONLYOFFICE configuration status
   */
  @Get('config')
  @Authenticated()
  getOnlyOfficeConfig(): Promise<OnlyOfficeConfigResponseDto> {
    return this.service.getOnlyOfficeConfig();
  }

  /**
   * Get document configuration for ONLYOFFICE editor
   */
  @Get('document/:id')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  getDocumentConfig(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<OnlyOfficeDocumentConfigDto> {
    return this.service.getDocumentConfig(auth, id);
  }

  /**
   * Check if ONLYOFFICE is available
   */
  @Get('available')
  @Authenticated()
  checkAvailable(): Promise<{ available: boolean }> {
    return this.service.isAvailable().then((available) => ({ available }));
  }

  /**
   * Download document for ONLYOFFICE (authenticated via token query parameter)
   * This endpoint is called by ONLYOFFICE server to fetch the document content
   */
  @Get('download/:id')
  @FileResponse()
  async downloadDocument(
    @Param() { id }: UUIDParamDto,
    @Query('token') token: string,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    // Validate the download token
    const result = this.service.validateDownloadToken(token, id);
    if (!result.valid) {
      throw new UnauthorizedException('Invalid or expired download token');
    }

    // Serve the file
    await sendFile(res, next, () => this.service.downloadDocument(id), this.logger);
  }
}
