import { Injectable } from '@nestjs/common';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  TranscriptionResponseDto,
  TranscriptionSearchMatchDto,
  TranscriptionSearchMatchesResponseDto,
  TranscriptionSegmentDto,
  WordTimestampDto,
} from 'src/dtos/transcription.dto';
import { AssetType, AssetVisibility, JobName, JobStatus, Permission, QueueName } from 'src/enum';
import { TranscriptionSegmentData, WordTimestamp } from 'src/repositories/transcription.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';

interface TranscriptionServiceResponse {
  language: string;
  language_probability: number;
  duration: number;
  segments: Array<{
    speaker: string | null;
    start: number;
    end: number;
    text: string;
    words: Array<{
      word: string;
      start: number;
      end: number;
      confidence: number;
    }> | null;
  }>;
}

@Injectable()
export class TranscriptionService extends BaseService {
  /**
   * Get full transcription for a video
   */
  async getTranscription(auth: AuthDto, assetId: string): Promise<TranscriptionResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const segments = await this.transcriptionRepository.getByAssetId(assetId);

    // Calculate total duration from segments
    const duration = segments.length > 0 ? Math.max(...segments.map((s) => s.endTime)) : 0;

    const formattedSegments: TranscriptionSegmentDto[] = segments.map((seg) => {
      let words: WordTimestampDto[] | null = null;
      if (seg.words) {
        try {
          words = JSON.parse(seg.words as string) as WordTimestampDto[];
        } catch {
          words = null;
        }
      }

      return {
        speaker: seg.speaker,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: seg.text,
        words,
      };
    });

    return {
      assetId,
      language: null, // Could store in a separate table if needed
      duration,
      segments: formattedSegments,
    };
  }

  /**
   * Search transcription and return matches with timestamps
   */
  async searchTranscription(
    auth: AuthDto,
    assetId: string,
    searchTerm: string,
  ): Promise<TranscriptionSearchMatchesResponseDto> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const segments = await this.transcriptionRepository.findMatchingSegments(assetId, searchTerm);
    const matches: TranscriptionSearchMatchDto[] = [];

    const searchLower = searchTerm.toLowerCase();

    for (const segment of segments) {
      const textLower = segment.text.toLowerCase();
      let startIndex = 0;

      while ((startIndex = textLower.indexOf(searchLower, startIndex)) !== -1) {
        // Extract snippet with context (~30 chars before and after)
        const snippetStart = Math.max(0, startIndex - 30);
        const snippetEnd = Math.min(segment.text.length, startIndex + searchTerm.length + 30);

        matches.push({
          startTime: segment.startTime,
          endTime: segment.endTime,
          textSnippet: segment.text.slice(snippetStart, snippetEnd),
          speaker: segment.speaker,
          matchStart: startIndex,
          matchEnd: startIndex + searchTerm.length,
        });

        startIndex += searchTerm.length;
      }
    }

    return {
      assetId,
      searchTerm,
      totalMatches: matches.length,
      matches,
    };
  }

  /**
   * Generate WebVTT subtitle file
   */
  async getVtt(auth: AuthDto, assetId: string): Promise<string> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });

    const segments = await this.transcriptionRepository.getByAssetId(assetId);

    let vtt = 'WEBVTT\n\n';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const startTime = this.formatVttTime(seg.startTime);
      const endTime = this.formatVttTime(seg.endTime);

      // Add cue identifier
      vtt += `${i + 1}\n`;
      vtt += `${startTime} --> ${endTime}\n`;

      // Add speaker label if available
      if (seg.speaker) {
        vtt += `<v ${seg.speaker}>${seg.text}\n\n`;
      } else {
        vtt += `${seg.text}\n\n`;
      }
    }

    return vtt;
  }

  /**
   * Check if a video has transcription
   */
  async hasTranscription(auth: AuthDto, assetId: string): Promise<boolean> {
    await this.requireAccess({ auth, permission: Permission.AssetView, ids: [assetId] });
    return this.transcriptionRepository.hasTranscription(assetId);
  }

  /**
   * Manually trigger re-transcription
   */
  async regenerateTranscription(auth: AuthDto, assetId: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.AssetUpdate, ids: [assetId] });

    // Delete existing transcription
    await this.transcriptionRepository.deleteByAssetId(assetId);

    // Queue the transcription job with high priority
    await this.jobRepository.queue({
      name: JobName.VideoTranscription,
      data: { id: assetId, priority: 1 },
    });
  }

  @OnJob({ name: JobName.VideoTranscriptionQueueAll, queue: QueueName.VideoTranscription })
  async handleQueueVideoTranscription({
    force,
  }: JobOf<JobName.VideoTranscriptionQueueAll>): Promise<JobStatus> {
    if (force) {
      this.logger.log('Force flag set - will re-transcribe all videos');
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForVideoTranscriptionJob(force);

    for await (const asset of assets) {
      // Calculate priority based on file size: smaller files = lower number = higher priority
      const fileSizeMB = asset.fileSizeInByte ? Number(asset.fileSizeInByte) / (1024 * 1024) : 999;

      // Priority mapping: 0-10MB=1, 10-100MB=10, 100-500MB=50, 500MB-1GB=100, 1GB+=200
      let priority: number;
      if (fileSizeMB <= 10) {
        priority = 1;
      } else if (fileSizeMB <= 100) {
        priority = 10;
      } else if (fileSizeMB <= 500) {
        priority = 50;
      } else if (fileSizeMB <= 1000) {
        priority = 100;
      } else {
        priority = 200;
      }

      jobs.push({
        name: JobName.VideoTranscription,
        data: { id: asset.id, priority },
      });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.VideoTranscription, queue: QueueName.VideoTranscription })
  async handleVideoTranscription({ id }: JobOf<JobName.VideoTranscription>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForVideoTranscription(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    if (asset.type !== AssetType.Video) {
      this.logger.debug(`Skipping non-video asset ${id}`);
      return JobStatus.Skipped;
    }

    try {
      // Get transcription service URL from config
      const config = this.configRepository.getEnv();
      const transcriptionUrl = config.transcription?.url;

      if (!transcriptionUrl) {
        this.logger.warn('Transcription service URL not configured');
        return JobStatus.Skipped;
      }

      // Check if transcription service is available
      const healthCheck = await this.checkTranscriptionServiceHealth(transcriptionUrl);
      if (!healthCheck) {
        this.logger.warn('Transcription service is not available');
        return JobStatus.Failed;
      }

      this.logger.log(`Starting transcription for video ${id}: ${asset.originalFileName}`);

      // Call transcription service
      const response = await fetch(`${transcriptionUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_path: asset.originalPath,
          diarization: true,
          word_timestamps: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Transcription service error for ${id}: ${errorText}`);
        return JobStatus.Failed;
      }

      const result = (await response.json()) as TranscriptionServiceResponse;

      // Store segments in database
      const segments: TranscriptionSegmentData[] = result.segments.map((seg) => ({
        speaker: seg.speaker,
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text,
        words: seg.words as WordTimestamp[] | null,
      }));

      await this.transcriptionRepository.upsertSegments(id, segments);

      this.logger.log(`Transcription complete for video ${id}: ${result.segments.length} segments`);
      return JobStatus.Success;
    } catch (error) {
      this.logger.error(`Transcription failed for video ${id}: ${error}`);
      return JobStatus.Failed;
    }
  }

  private async checkTranscriptionServiceHealth(url: string): Promise<boolean> {
    try {
      const response = await fetch(`${url}/ping`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private formatVttTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
}
