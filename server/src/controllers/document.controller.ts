import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  DocumentSearchMatchesResponseDto,
  DocumentSearchQueryDto,
  PageNumberParamDto,
  PageTextPositionsResponseDto,
} from 'src/dtos/document.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { DocumentService } from 'src/services/document.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Assets)
@Controller('documents')
export class DocumentController {
  constructor(private service: DocumentService) {}

  @Get(':id/search-matches')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  async getSearchMatches(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { q }: DocumentSearchQueryDto,
  ): Promise<DocumentSearchMatchesResponseDto> {
    return this.service.getSearchMatches(auth, id, q);
  }

  @Get(':id/pages/:pageNumber/text-positions')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  async getPageTextPositions(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Param() { pageNumber }: PageNumberParamDto,
  ): Promise<PageTextPositionsResponseDto> {
    return this.service.getPageTextPositions(auth, id, pageNumber);
  }

  @Get(':id/pages')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  async getAllPages(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<PageTextPositionsResponseDto[]> {
    return this.service.getAllPages(auth, id);
  }
}
