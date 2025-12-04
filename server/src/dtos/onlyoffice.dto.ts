export class OnlyOfficeConfigResponseDto {
  enabled!: boolean;
  externalUrl!: string;
}

export class OnlyOfficeDocumentConfigDto {
  documentKey!: string;
  documentUrl!: string;
  documentType!: 'word' | 'cell' | 'slide';
  fileType!: string;
  title!: string;
  token!: string;
}

export type OnlyOfficeDocumentType = 'word' | 'cell' | 'slide';

export interface OnlyOfficeFileTypeConfig {
  documentType: OnlyOfficeDocumentType;
  fileType: string;
}

// Extension to ONLYOFFICE file type mapping
export const ONLYOFFICE_FILE_TYPES: Record<string, OnlyOfficeFileTypeConfig> = {
  '.docx': { documentType: 'word', fileType: 'docx' },
  '.doc': { documentType: 'word', fileType: 'doc' },
  '.odt': { documentType: 'word', fileType: 'odt' },
  '.rtf': { documentType: 'word', fileType: 'rtf' },
  '.txt': { documentType: 'word', fileType: 'txt' },
  '.xlsx': { documentType: 'cell', fileType: 'xlsx' },
  '.xls': { documentType: 'cell', fileType: 'xls' },
  '.ods': { documentType: 'cell', fileType: 'ods' },
  '.csv': { documentType: 'cell', fileType: 'csv' },
  '.pptx': { documentType: 'slide', fileType: 'pptx' },
  '.ppt': { documentType: 'slide', fileType: 'ppt' },
  '.odp': { documentType: 'slide', fileType: 'odp' },
  '.pdf': { documentType: 'word', fileType: 'pdf' },
};
