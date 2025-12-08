import { Controller, Get, Header, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  TranscriptionResponseDto,
  TranscriptionSearchMatchesResponseDto,
  TranscriptionSearchQueryDto,
} from 'src/dtos/transcription.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { TranscriptionService } from 'src/services/transcription.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Assets)
@Controller('videos')
export class TranscriptionController {
  constructor(private service: TranscriptionService) {}

  @Get(':id/transcription')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  async getTranscription(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<TranscriptionResponseDto> {
    return this.service.getTranscription(auth, id);
  }

  @Get(':id/transcription/search')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  async searchTranscription(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() { q }: TranscriptionSearchQueryDto,
  ): Promise<TranscriptionSearchMatchesResponseDto> {
    return this.service.searchTranscription(auth, id, q);
  }

  @Get(':id/transcription/vtt')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  @Header('Content-Type', 'text/vtt')
  @Header('Content-Disposition', 'inline')
  async getVtt(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<string> {
    return this.service.getVtt(auth, id);
  }

  @Get(':id/transcription/available')
  @Authenticated({ permission: Permission.AssetView, sharedLink: true })
  async hasTranscription(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
  ): Promise<{ available: boolean }> {
    const available = await this.service.hasTranscription(auth, id);
    return { available };
  }

  @Post(':id/transcription/regenerate')
  @Authenticated({ permission: Permission.AssetUpdate })
  async regenerateTranscription(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.regenerateTranscription(auth, id);
  }
}
