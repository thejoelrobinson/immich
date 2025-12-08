import { AssetTable } from 'src/schema/tables/asset.table';
import { Column, ForeignKeyColumn, Generated, Index, PrimaryGeneratedColumn, Table } from 'src/sql-tools';

@Table('transcription_segments')
@Index({
  name: 'idx_transcription_segments_asset_time',
  columns: ['assetId', 'startTime'],
})
@Index({
  name: 'idx_transcription_segments_text',
  using: 'gin',
  expression: 'f_unaccent("text") gin_trgm_ops',
})
export class TranscriptionSegmentsTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  assetId!: string;

  // Speaker identification (e.g., "SPEAKER_0", "SPEAKER_1")
  @Column({ type: 'character varying', nullable: true })
  speaker!: string | null;

  // Start time in seconds
  @Column({ type: 'real' })
  startTime!: number;

  // End time in seconds
  @Column({ type: 'real' })
  endTime!: number;

  // Transcribed text
  @Column({ type: 'text' })
  text!: string;

  // JSONB array of word timestamps: [{word, start, end, confidence}]
  @Column({ type: 'jsonb', nullable: true })
  words!: string | null;
}
