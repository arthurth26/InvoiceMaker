import { invoke } from "@tauri-apps/api/core";

import type { Client, CompanyInfo, Document, StoredRecord } from "../types/invoice";

export function getCompany(): Promise<StoredRecord<CompanyInfo> | null> {
  return invoke("get_company");
}

export function saveCompany(record: StoredRecord<CompanyInfo>): Promise<void> {
  return invoke("save_company", { record });
}

export function listClients(): Promise<StoredRecord<Client>[]> {
  return invoke("list_clients");
}

export function saveClient(record: StoredRecord<Client>): Promise<void> {
  return invoke("save_client", { record });
}

export function replaceClient(record: StoredRecord<Client>): Promise<void> {
  return invoke("replace_client", { record });
}

export function listDocuments(): Promise<StoredRecord<Document>[]> {
  return invoke("list_documents");
}

export function getDocument(id: string): Promise<StoredRecord<Document> | null> {
  return invoke("get_document", { id });
}

export function createDocument(record: StoredRecord<Document>): Promise<void> {
  return invoke("create_document", { record });
}

export function updateDocument(record: StoredRecord<Document>): Promise<void> {
  return invoke("update_document", { record });
}

export function storeProof(source: string, documentId: string): Promise<string> {
  return invoke("store_proof", { source, documentId });
}

export function openProof(relativePath: string): Promise<void> {
  return invoke("open_proof", { relativePath });
}

export function deleteDocument(id: string): Promise<void> {
  return invoke("delete_document", { id });
}

export function createManualBackup(destination: string): Promise<void> {
  return invoke("create_manual_backup", { destination });
}

export function savePdf(destination: string, contents: number[]): Promise<void> {
  return invoke("save_pdf", { destination, contents });
}