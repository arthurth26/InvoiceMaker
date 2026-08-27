import { FormEvent, useEffect, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { DatabaseBackup, FileDown } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";

import { createManualBackup, getCompany, listClients, listDocuments, saveCompany, savePdf } from "./services/invoiceRepository";
import DocumentEditor from "./components/DocumentEditor";
import InvoicePdf from "./components/InvoicePdf";
import type { Client, CompanyInfo, Document, StoredRecord } from "./types/invoice";
import "./App.css";

const defaultCompany: CompanyInfo = {
  name: "", address: "", email: "", phone: "", taxId: "", logoPath: null,
  defaultCurrency: "USD", outputDirectory: "",
};

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountCents / 100);
}

function App() {
  const [companyRecord, setCompanyRecord] = useState<StoredRecord<CompanyInfo> | null>(null);
  const [company, setCompany] = useState(defaultCompany);
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof listDocuments>>>([]);
  const [clients, setClients] = useState<StoredRecord<Client>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingPdfId, setSavingPdfId] = useState<string | null>(null);

  useEffect(() => { void loadDashboard(); }, []);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);
    try {
      const [savedCompany, savedDocuments, savedClients] = await Promise.all([getCompany(), listDocuments(), listClients()]);
      setCompanyRecord(savedCompany);
      setCompany(savedCompany?.data ?? defaultCompany);
      setDocuments(savedDocuments);
      setClients(savedClients);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load local records.");
    } finally { setIsLoading(false); }
  }

  async function handleSaveCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const record: StoredRecord<CompanyInfo> = {
      id: "company", recordKind: "company", createdAt: companyRecord?.createdAt ?? timestamp,
      updatedAt: timestamp, data: company,
    };
    try {
      await saveCompany(record);
      setCompanyRecord(record);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save company details.");
    } finally { setIsSaving(false); }
  }

  async function handleCreateBackup() {
    setSuccessMessage(null);
    setError(null);
    const destination = await save({
      defaultPath: `invoicemaker-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: "SQLite database", extensions: ["db"] }],
    });
    if (!destination) return;

    setIsBackingUp(true);
    try {
      await createManualBackup(destination);
      setSuccessMessage("Database backup created.");
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "Unable to create database backup.");
    } finally { setIsBackingUp(false); }
  }

  async function handleSavePdf(document: Document) {
    setSuccessMessage(null);
    setError(null);
    const destination = await save({
      defaultPath: `${document.invoiceNumber}.pdf`,
      filters: [{ name: "PDF document", extensions: ["pdf"] }],
    });
    if (!destination) return;

    setSavingPdfId(document.id);
    try {
      const client = clients.find((record) => record.id === document.clientId)?.data ?? null;
      const blob = await pdf(<InvoicePdf company={company} client={client} document={document} />).toBlob();
      const contents = Array.from(new Uint8Array(await blob.arrayBuffer()));
      await savePdf(destination, contents);
      setSuccessMessage(`${document.invoiceNumber} saved as a PDF.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save PDF.");
    } finally { setSavingPdfId(null); }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Local ledger</p><h1>Invoice Maker</h1></div>
        <div className="topbar-actions">
          <button className="icon-button" type="button" aria-label="Create database backup" title="Create database backup" disabled={isBackingUp} onClick={() => void handleCreateBackup()}><DatabaseBackup aria-hidden="true" size={18} /></button>
          <button className="refresh-button" type="button" onClick={() => void loadDashboard()}>Refresh</button>
        </div>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}
      {successMessage && <p className="notice success" role="status">{successMessage}</p>}

      <section className="company-section" aria-labelledby="company-heading">
        <div className="section-heading">
          <div><p className="eyebrow">Business profile</p><h2 id="company-heading">Company details</h2></div>
          <span className="saved-state">{companyRecord ? "Saved locally" : "Not configured"}</span>
        </div>
        <form className="company-form" onSubmit={handleSaveCompany}>
          <label>Company name<input required value={company.name} onChange={(event) => setCompany({ ...company, name: event.target.value })} /></label>
          <label>Email<input type="email" value={company.email} onChange={(event) => setCompany({ ...company, email: event.target.value })} /></label>
          <label>Phone<input value={company.phone} onChange={(event) => setCompany({ ...company, phone: event.target.value })} /></label>
          <label>Tax ID<input value={company.taxId} onChange={(event) => setCompany({ ...company, taxId: event.target.value })} /></label>
          <label>Default currency<select value={company.defaultCurrency} onChange={(event) => setCompany({ ...company, defaultCurrency: event.target.value })}><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option><option value="CAD">CAD</option></select></label>
          <label>Output directory<input value={company.outputDirectory} onChange={(event) => setCompany({ ...company, outputDirectory: event.target.value })} /></label>
          <label className="wide-field">Address<textarea rows={2} value={company.address} onChange={(event) => setCompany({ ...company, address: event.target.value })} /></label>
          <div className="form-actions"><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save company"}</button></div>
        </form>
      </section>

      <section className="documents-section" aria-labelledby="documents-heading">
        <div className="section-heading"><div><p className="eyebrow">Documents</p><h2 id="documents-heading">Invoices and quotes</h2></div><div className="document-actions"><span className="document-count">{documents.length} total</span><button className="primary-button" type="button" onClick={() => setIsEditorOpen(true)}>New document</button></div></div>
        {isLoading ? <p className="empty-state">Loading local records...</p> : documents.length === 0 ? <p className="empty-state">No invoices or quotes yet.</p> : (
          <div className="table-wrap"><table><thead><tr><th>Number</th><th>Type</th><th>Issue date</th><th>Status</th><th>Payment</th><th>Total</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
            {documents.map(({ id, data }) => <tr key={id}><td>{data.invoiceNumber}</td><td>{data.documentType}</td><td>{data.issueDate}</td><td><span className={`status ${data.status}`}>{data.status}</span></td><td>{data.paymentReceived ? data.paymentReceivedDate ?? "Received" : "Outstanding"}</td><td>{formatMoney(data.totalCents, data.currency)}</td><td className="actions-cell"><button className="icon-button" type="button" aria-label={`Save ${data.invoiceNumber} as PDF`} title="Save PDF" disabled={savingPdfId === data.id} onClick={() => void handleSavePdf(data)}><FileDown aria-hidden="true" size={18} /></button></td></tr>)}
          </tbody></table></div>
        )}
      </section>
      {isEditorOpen && <DocumentEditor defaultCurrency={company.defaultCurrency} onClose={() => setIsEditorOpen(false)} onCreated={loadDashboard} />}
    </main>
  );
}

export default App;
