import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class WordTimestampDto {
  @ApiProperty({ type: 'string', description: 'Word text' })
  word!: string;

  @ApiProperty({ type: 'number', format: 'double', description: 'Start time in seconds' })
  start!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'End time in seconds' })
  end!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'Confidence score (0-1)' })
  confidence!: number;
}

export class TranscriptionSegmentDto {
  @ApiProperty({ type: 'string', nullable: true, description: 'Speaker identifier (e.g., SPEAKER_0)' })
  speaker!: string | null;

  @ApiProperty({ type: 'number', format: 'double', description: 'Start time in seconds' })
  startTime!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'End time in seconds' })
  endTime!: number;

  @ApiProperty({ type: 'string', description: 'Transcribed text' })
  text!: string;

  @ApiProperty({ type: [WordTimestampDto], nullable: true, description: 'Word-level timestamps' })
  words!: WordTimestampDto[] | null;
}

export class TranscriptionResponseDto {
  @ApiProperty({ type: 'string', format: 'uuid', description: 'Asset ID' })
  assetId!: string;

  @ApiProperty({ type: 'string', nullable: true, description: 'Detected language code (e.g., en, es)' })
  language!: string | null;

  @ApiProperty({ type: 'number', format: 'double', description: 'Total duration in seconds' })
  duration!: number;

  @ApiProperty({ type: [TranscriptionSegmentDto], description: 'Transcription segments' })
  segments!: TranscriptionSegmentDto[];
}

export class TranscriptionSearchMatchDto {
  @ApiProperty({ type: 'number', format: 'double', description: 'Start time in seconds' })
  startTime!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'End time in seconds' })
  endTime!: number;

  @ApiProperty({ type: 'string', description: 'Text snippet with context around the match' })
  textSnippet!: string;

  @ApiProperty({ type: 'string', nullable: true, description: 'Speaker identifier' })
  speaker!: string | null;

  @ApiProperty({ type: 'integer', description: 'Character offset where match starts in segment text' })
  matchStart!: number;

  @ApiProperty({ type: 'integer', description: 'Character offset where match ends in segment text' })
  matchEnd!: number;

  @ApiProperty({ type: 'number', format: 'double', nullable: true, description: 'Exact word start time for precise seeking (null if word timing unavailable)' })
  wordStartTime!: number | null;
}

export class TranscriptionSearchMatchesResponseDto {
  @ApiProperty({ type: 'string', format: 'uuid', description: 'Asset ID' })
  assetId!: string;

  @ApiProperty({ type: 'string', description: 'Search term used' })
  searchTerm!: string;

  @ApiProperty({ type: 'integer', description: 'Total number of matches found' })
  totalMatches!: number;

  @ApiProperty({ type: [TranscriptionSearchMatchDto], description: 'List of matches' })
  matches!: TranscriptionSearchMatchDto[];
}

export class TranscriptionSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @ApiProperty({ type: 'string', description: 'Search term to find in transcription', maxLength: 500 })
  q!: string;
}
