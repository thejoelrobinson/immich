import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class TextPositionDto {
  @ApiProperty({ type: 'string', description: 'Text content' })
  text!: string;

  @ApiProperty({ type: 'number', format: 'double', description: 'Normalized x coordinate (0-1)' })
  x!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'Normalized y coordinate (0-1)' })
  y!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'Normalized width (0-1)' })
  width!: number;

  @ApiProperty({ type: 'number', format: 'double', description: 'Normalized height (0-1)' })
  height!: number;
}

export class DocumentSearchMatchDto {
  @ApiProperty({ type: 'integer', description: 'Page number (1-indexed)' })
  pageNumber!: number;

  @ApiProperty({ type: 'string', description: 'Text snippet with context around the match' })
  textSnippet!: string;

  @ApiProperty({ type: 'integer', description: 'Character offset where match starts in page text' })
  matchStart!: number;

  @ApiProperty({ type: 'integer', description: 'Character offset where match ends in page text' })
  matchEnd!: number;
}

export class DocumentSearchMatchesResponseDto {
  @ApiProperty({ type: 'string', format: 'uuid', description: 'Asset ID' })
  assetId!: string;

  @ApiProperty({ type: 'string', description: 'Search term used' })
  searchTerm!: string;

  @ApiProperty({ type: 'integer', description: 'Total number of matches found' })
  totalMatches!: number;

  @ApiProperty({ type: [DocumentSearchMatchDto], description: 'List of matches' })
  matches!: DocumentSearchMatchDto[];
}

export class PageTextPositionsResponseDto {
  @ApiProperty({ type: 'integer', description: 'Page number (1-indexed)' })
  pageNumber!: number;

  @ApiProperty({ type: 'string', description: 'Full text of the page' })
  text!: string;

  @ApiProperty({ type: [TextPositionDto], nullable: true, description: 'Text items with positions' })
  textItems!: TextPositionDto[] | null;
}

export class DocumentSearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  @ApiProperty({ type: 'string', description: 'Search term to find in document', maxLength: 500 })
  q!: string;
}

export class PageNumberParamDto {
  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number.parseInt(value, 10))
  @ApiProperty({ type: 'integer', description: 'Page number (1-indexed)', minimum: 1 })
  pageNumber!: number;
}
