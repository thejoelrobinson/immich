import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';

export interface TextItem {
  text: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  width: number; // normalized 0-1
  height: number; // normalized 0-1
}

export interface PageTextData {
  pageNumber: number;
  text: string;
  textItems: TextItem[] | null;
}

export interface PageMatch {
  pageNumber: number;
  text: string;
}

@Injectable()
export class DocumentTextRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getByAssetId(assetId: string) {
    return this.db
      .selectFrom('document_text_positions')
      .selectAll()
      .where('assetId', '=', assetId)
      .orderBy('pageNumber', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  getPage(assetId: string, pageNumber: number) {
    return this.db
      .selectFrom('document_text_positions')
      .selectAll()
      .where('assetId', '=', assetId)
      .where('pageNumber', '=', pageNumber)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  findMatchingPages(assetId: string, searchTerm: string): Promise<PageMatch[]> {
    // Escape SQL LIKE pattern special characters to prevent wildcard injection
    const escapedTerm = searchTerm.replaceAll(/[%_\\]/g, String.raw`\$&`);
    const pattern = `%${escapedTerm}%`;

    // Use case-insensitive search with ILIKE
    return this.db
      .selectFrom('document_text_positions')
      .select(['pageNumber', 'text'])
      .where('assetId', '=', assetId)
      .where('text', 'ilike', pattern)
      .orderBy('pageNumber', 'asc')
      .execute();
  }

  @GenerateSql({
    params: [
      DummyValue.UUID,
      [
        {
          pageNumber: 1,
          text: DummyValue.STRING,
          textItems: null,
        },
      ],
    ],
  })
  async upsertPages(assetId: string, pages: PageTextData[]): Promise<void> {
    // Delete existing pages for this asset, then insert new ones
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('document_text_positions').where('assetId', '=', assetId).execute();

      if (pages.length > 0) {
        await trx
          .insertInto('document_text_positions')
          .values(
            pages.map((page) => ({
              assetId,
              pageNumber: page.pageNumber,
              text: page.text,
              textItems: page.textItems ? JSON.stringify(page.textItems) : null,
            })),
          )
          .execute();
      }
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  deleteByAssetId(assetId: string) {
    return this.db.deleteFrom('document_text_positions').where('assetId', '=', assetId).execute();
  }
}
