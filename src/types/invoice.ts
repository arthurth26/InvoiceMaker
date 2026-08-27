export type RecordKind = "company" | "client" | "document";
export type DocumentType = "quote" | "invoice";
export type DocumentStatus = "draft" | "sent" | "accepted" | "invoiced" | "paid";

export interface StoredRecord<T> {
  id: string;
  recordKind: RecordKind;
  createdAt: string;
  updatedAt: string;
  data: T;
}

export interface CompanyInfo {
  name: string;
  address: string;
  email: string;
  phone: string;
  taxId: string;
  logoPath: string | null;
  defaultCurrency: string;
  outputDirectory: string;
}

export interface Client {
  id: string;
  name: string;
  address: string;
  email: string;
  phone: string;
  taxId: string | null;
}

export interface Attachment {
  relativePath: string;
  originalFilename: string;
}

export interface LineItem {
  description: string;
  quantityMilliunits: number;
  unitPriceCents: number;
  taxRateBasisPoints: number;
  discountCents: number;
}

export interface Document {
  id: string;
  invoiceNumber: string;
  documentType: DocumentType;
  clientId: string;
  status: DocumentStatus;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  lineItems: LineItem[];
  subtotalCents: number;
  taxAmountCents: number;
  totalCents: number;
  paymentReceived: boolean;
  paymentReceivedDate: string | null;
  attachments: Attachment[];
  notes: string | null;
}