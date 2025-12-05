import { AssetTable } from 'src/schema/tables/asset.table';
import { Column, ForeignKeyColumn, Generated, Index, PrimaryGeneratedColumn, Table } from 'src/sql-tools';

@Table('document_text_positions')
@Index({
  name: 'idx_document_text_positions_asset_page',
  columns: ['assetId', 'pageNumber'],
})
@Index({
  name: 'idx_document_text_positions_text',
  using: 'gin',
  expression: 'f_unaccent("text") gin_trgm_ops',
})
export class DocumentTextPositionsTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  assetId!: string;

  @Column({ type: 'integer' })
  pageNumber!: number;

  @Column({ type: 'text' })
  text!: string;

  // JSONB array of text items with positions: [{text, x, y, width, height}]
  // Positions are normalized 0-1 coordinates
  @Column({ type: 'jsonb', nullable: true })
  textItems!: string | null;
}
