import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { DB } from 'src/schema';

export interface WordTimestamp {
  word: string;
  start: number; // seconds
  end: number; // seconds
  confidence: number;
}

export interface TranscriptionSegmentData {
  speaker: string | null;
  startTime: number;
  endTime: number;
  text: string;
  words: WordTimestamp[] | null;
}

export interface SegmentMatch {
  startTime: number;
  endTime: number;
  speaker: string | null;
  text: string;
}

@Injectable()
export class TranscriptionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getByAssetId(assetId: string) {
    return this.db
      .selectFrom('transcription_segments')
      .selectAll()
      .where('assetId', '=', assetId)
      .orderBy('startTime', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  getSegmentAtTime(assetId: string, time: number) {
    return this.db
      .selectFrom('transcription_segments')
      .selectAll()
      .where('assetId', '=', assetId)
      .where('startTime', '<=', time)
      .where('endTime', '>=', time)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  findMatchingSegments(assetId: string, searchTerm: string): Promise<SegmentMatch[]> {
    // Escape SQL LIKE pattern special characters to prevent wildcard injection
    const escapedTerm = searchTerm.replaceAll(/[%_\\]/g, String.raw`\$&`);
    const pattern = `%${escapedTerm}%`;

    // Use case-insensitive search with ILIKE
    return this.db
      .selectFrom('transcription_segments')
      .select(['startTime', 'endTime', 'speaker', 'text'])
      .where('assetId', '=', assetId)
      .where('text', 'ilike', pattern)
      .orderBy('startTime', 'asc')
      .execute();
  }

  @GenerateSql({
    params: [
      DummyValue.UUID,
      [
        {
          speaker: 'SPEAKER_0',
          startTime: 0.0,
          endTime: 5.0,
          text: DummyValue.STRING,
          words: null,
        },
      ],
    ],
  })
  async upsertSegments(assetId: string, segments: TranscriptionSegmentData[]): Promise<void> {
    // Delete existing segments for this asset, then insert new ones
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('transcription_segments').where('assetId', '=', assetId).execute();

      if (segments.length > 0) {
        await trx
          .insertInto('transcription_segments')
          .values(
            segments.map((segment) => ({
              assetId,
              speaker: segment.speaker,
              startTime: segment.startTime,
              endTime: segment.endTime,
              text: segment.text,
              words: segment.words ? JSON.stringify(segment.words) : null,
            })),
          )
          .execute();
      }
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  deleteByAssetId(assetId: string) {
    return this.db.deleteFrom('transcription_segments').where('assetId', '=', assetId).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  hasTranscription(assetId: string) {
    return this.db
      .selectFrom('transcription_segments')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .where('assetId', '=', assetId)
      .executeTakeFirst()
      .then((result) => (result?.count ?? 0) > 0);
  }
}
