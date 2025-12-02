import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnJob } from 'src/decorators';
import { AssetType, AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';

@Injectable()
export class DocumentService extends BaseService {
  @OnJob({ name: JobName.DocumentTextExtractionQueueAll, queue: QueueName.DocumentExtraction })
  async handleQueueDocumentTextExtraction({ force }: JobOf<JobName.DocumentTextExtractionQueueAll>): Promise<JobStatus> {
    if (force) {
      // Delete all existing document text from ocr_search for documents
      // Note: We're reusing the ocr_search table for document text
      this.logger.log('Force flag set - will re-extract text from all documents');
    }

    let jobs: JobItem[] = [];
    const assets = this.assetJobRepository.streamForDocumentTextExtractionJob(force);

    for await (const asset of assets) {
      jobs.push({ name: JobName.DocumentTextExtraction, data: { id: asset.id } });

      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(jobs);
        jobs = [];
      }
    }

    await this.jobRepository.queueAll(jobs);
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.DocumentTextExtraction, queue: QueueName.DocumentExtraction })
  async handleDocumentTextExtraction({ id }: JobOf<JobName.DocumentTextExtraction>): Promise<JobStatus> {
    const asset = await this.assetJobRepository.getForDocumentTextExtraction(id);
    if (!asset) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    if (asset.type !== AssetType.Document) {
      this.logger.debug(`Skipping non-document asset ${id}`);
      return JobStatus.Skipped;
    }

    try {
      const extractedText = await this.extractTextFromDocument(asset.originalPath, asset.originalFileName);

      if (extractedText && extractedText.trim().length > 0) {
        // Store the extracted text using the OCR repository (reusing existing infrastructure)
        // The ocr_search table is already optimized for text search with trigram indexes
        await this.ocrRepository.upsert(id, [
          {
            assetId: id,
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            x3: 1,
            y3: 1,
            x4: 0,
            y4: 1,
            boxScore: 1,
            textScore: 1,
            text: extractedText,
          },
        ]);

        this.logger.debug(`Extracted ${extractedText.length} characters from document ${id}`);
      }

      await this.assetRepository.upsertJobStatus({ assetId: id, documentTextExtractedAt: new Date() });

      return JobStatus.Success;
    } catch (error) {
      this.logger.error(`Failed to extract text from document ${id}: ${error}`);
      return JobStatus.Failed;
    }
  }

  private async extractTextFromDocument(filePath: string, fileName: string): Promise<string> {
    const extension = fileName.toLowerCase().split('.').pop();

    switch (extension) {
      case 'txt':
      case 'md':
      case 'csv':
      case 'json':
      case 'xml':
      case 'html':
      case 'htm': {
        return this.extractTextFromPlainText(filePath);
      }

      case 'pdf': {
        return this.extractTextFromPdf(filePath);
      }

      case 'epub': {
        return this.extractTextFromEpub(filePath);
      }

      case 'rtf': {
        return this.extractTextFromRtf(filePath);
      }

      case 'doc':
      case 'docx':
      case 'odt': {
        // These formats would require additional libraries
        // For now, return empty and log a warning
        this.logger.warn(`Document format .${extension} text extraction not yet implemented for ${fileName}`);
        return '';
      }

      default: {
        this.logger.debug(`Unknown document format .${extension} for ${fileName}`);
        return '';
      }
    }
  }

  private async extractTextFromPlainText(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return content;
    } catch (error) {
      this.logger.error(`Failed to read text file ${filePath}: ${error}`);
      return '';
    }
  }

  private async extractTextFromPdf(filePath: string): Promise<string> {
    try {
      // Dynamically import pdf-parse to avoid loading it when not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
      const pdfParse = require('pdf-parse');
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      return data.text || '';
    } catch (error) {
      this.logger.error(`Failed to extract text from PDF ${filePath}: ${error}`);
      return '';
    }
  }

  private async extractTextFromEpub(filePath: string): Promise<string> {
    try {
      // Dynamically import epub2 to avoid loading it when not needed
      const epub2 = await import('epub2');
      const epub = await epub2.EPub.createAsync(filePath);

      const chapters: string[] = [];
      for (const chapter of epub.flow) {
        try {
          const chapterText = await new Promise<string>((resolve, reject) => {
            epub.getChapter(chapter.id, (err: Error | null, text: string) => {
              if (err) {
                reject(err);
              } else {
                resolve(text || '');
              }
            });
          });

          // Strip HTML tags from chapter content
          const plainText = chapterText.replaceAll(/<[^>]*>/g, ' ').replaceAll(/\s+/g, ' ').trim();
          if (plainText) {
            chapters.push(plainText);
          }
        } catch {
          // Skip chapters that fail to parse
        }
      }

      return chapters.join('\n\n');
    } catch (error) {
      this.logger.error(`Failed to extract text from EPUB ${filePath}: ${error}`);
      return '';
    }
  }

  private async extractTextFromRtf(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      // Basic RTF text extraction - strips RTF control codes
      // This is a simplified implementation; a proper RTF parser would be better
      const text = content
        .replaceAll(/\\par[d]?/g, '\n')
        .replaceAll(/\{[^{}]*\}/g, '')
        .replaceAll(/\\[a-z]+\d*\s?/gi, '')
        .replaceAll(/[{}\\]/g, '')
        .trim();
      return text;
    } catch (error) {
      this.logger.error(`Failed to extract text from RTF ${filePath}: ${error}`);
      return '';
    }
  }
}
