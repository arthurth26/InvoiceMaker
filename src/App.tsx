import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { pdf } from "@react-pdf/renderer";
import { ArrowDownAZ, ArrowUpAZ, DatabaseBackup, ExternalLink, FileDown, FolderOpen, ListFilter, Pencil, Trash2 } from "lucide-react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";

import { createManualBackup, deleteDocument, getCompany, listClients, listDocuments, openProof, saveCompany, savePdf, storeProof, updateDocument } from "./services/invoiceRepository";
import DocumentEditor from "./components/DocumentEditor";
import InvoicePdf from "./components/InvoicePdf";
import type { Client, CompanyInfo, Document, StoredRecord } from "./types/invoice";
import "./App.css";

const defaultCompany: CompanyInfo = {
  name: "", address: "", email: "", phone: "", taxId: "", logoPath: null,
  defaultCurrency: "HKD", outputDirectory: "",
};

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountCents / 100);
}

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type FilterKey = "invoiceNumber" | "documentType" | "issueDate" | "client" | "status" | "payment" | "total";
type SortDirection = "ascending" | "descending";

const filterLabels: Record<FilterKey, string> = {
  invoiceNumber: "Number", documentType: "Type", issueDate: "Issue date", client: "Client",
  status: "Status", payment: "Payment", total: "Total",
};

function nextDocumentNumber(documents: StoredRecord<Document>[]) {
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^INV-${year}-(\\d{3})-\\d{2}$`);
  const highestSequence = documents.reduce((highest, record) => {
    const match = pattern.exec(record.data.invoiceNumber);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `INV-${year}-${String(highestSequence + 1).padStart(3, "0")}-00`;
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
  const [editingRecord, setEditingRecord] = useState<StoredRecord<Document> | null>(null);
  const [duplicateDocument, setDuplicateDocument] = useState<Document | null>(null);
  const [updatingPaymentId, setUpdatingPaymentId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ invoiceNumber: "", documentType: "", issueDate: "", client: "", status: "", payment: "", total: "" });
  const [sort, setSort] = useState<{ key: FilterKey; direction: SortDirection }>({ key: "issueDate", direction: "descending" });

  const documentRows = documents.map((record) => ({ record, clientName: clients.find((client) => client.id === record.data.clientId)?.data.name ?? "Unknown client" }));
  const visibleDocuments = documentRows
    .filter(({ record, clientName }) => {
      const values: Record<FilterKey, string> = {
        invoiceNumber: record.data.invoiceNumber, documentType: record.data.documentType, issueDate: record.data.issueDate,
        client: clientName, status: record.data.status, payment: record.data.paymentReceived ? "received" : "outstanding",
        total: formatMoney(record.data.totalCents, record.data.currency),
      };
      return (Object.keys(filters) as FilterKey[]).every((key) => values[key].toLowerCase().includes(filters[key].toLowerCase()));
    })
    .sort((left, right) => {
      const leftValue = sort.key === "client" ? left.clientName : sort.key === "total" ? left.record.data.totalCents : sort.key === "payment" ? Number(left.record.data.paymentReceived) : left.record.data[sort.key === "invoiceNumber" ? "invoiceNumber" : sort.key === "documentType" ? "documentType" : sort.key === "issueDate" ? "issueDate" : "status"];
      const rightValue = sort.key === "client" ? right.clientName : sort.key === "total" ? right.record.data.totalCents : sort.key === "payment" ? Number(right.record.data.paymentReceived) : right.record.data[sort.key === "invoiceNumber" ? "invoiceNumber" : sort.key === "documentType" ? "documentType" : sort.key === "issueDate" ? "issueDate" : "status"];
      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
      return sort.direction === "ascending" ? comparison : -comparison;
    });

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

  const handleSaveCompany: FormSubmitHandler = async (event) => {
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
  };

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

  function openNewDocument() {
    setEditingRecord(null);
    setDuplicateDocument(null);
    setIsEditorOpen(true);
  }

  function updateFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function toggleSort(key: FilterKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
      : { key, direction: "ascending" });
  }

  async function chooseCompanyPath(field: "logoPath" | "outputDirectory") {
    const selected = await open(field === "outputDirectory"
      ? { directory: true, multiple: false, title: "Choose output directory" }
      : { directory: false, multiple: false, title: "Choose company logo", filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (typeof selected === "string") setCompany((current) => ({ ...current, [field]: selected }));
  }

  function openDocumentEditor(record: StoredRecord<Document>) {
    setDuplicateDocument(null);
    setEditingRecord(record);
    setIsEditorOpen(true);
  }

  async function markDocumentPaid(record: StoredRecord<Document>) {
	const source = await open({ directory: false, multiple: false, title: "Choose payment proof" });
	if (typeof source !== "string") return;
    const timestamp = new Date().toISOString();
    setError(null);
    setSuccessMessage(null);
    setUpdatingPaymentId(record.id);
    try {
		const relativePath = await storeProof(source, record.id);
		const originalFilename = source.split(/[\\/]/).pop() || "payment-proof";
      await updateDocument({
        ...record,
        updatedAt: timestamp,
        data: {
          ...record.data,
          status: "paid",
          paymentReceived: true,
          paymentReceivedDate: timestamp.slice(0, 10),
		  attachments: [...record.data.attachments, { relativePath, originalFilename }],
        },
      });
      await loadDashboard();
      setSuccessMessage(`${record.data.invoiceNumber} marked as paid.`);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "Unable to mark document as paid.");
    } finally { setUpdatingPaymentId(null); }
  }

  async function handleOpenProof(record: StoredRecord<Document>) {
  const proof = record.data.attachments[0];
  if (!proof) return;
  setError(null);
  try {
    await openProof(proof.relativePath);
  } catch (proofError) {
    setError(proofError instanceof Error ? proofError.message : "Unable to open payment proof.");
  }
  }

  async function handleDeleteDocument(record: StoredRecord<Document>) {
  const shouldDelete = await ask(
    `Delete ${record.data.invoiceNumber}? A database backup will be created first.`,
    { kind: "warning", title: "Delete document" },
  );
  if (!shouldDelete) return;
  setError(null);
  setSuccessMessage(null);
  try {
    await deleteDocument(record.id);
    await loadDashboard();
    setSuccessMessage(`${record.data.invoiceNumber} deleted. A database backup was created first.`);
  } catch (deleteError) {
    setError(deleteError instanceof Error ? deleteError.message : "Unable to delete document.");
  }
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditingRecord(null);
    setDuplicateDocument(null);
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
          <label>Default currency<select value={company.defaultCurrency} onChange={(event) => setCompany({ ...company, defaultCurrency: event.target.value })}><option value="HKD">HKD</option><option value="USD">USD</option></select></label>
          <label>Logo file<div className="path-input"><input value={company.logoPath ?? ""} onChange={(event) => setCompany({ ...company, logoPath: event.target.value || null })} /><button className="icon-button" type="button" aria-label="Choose company logo" title="Choose company logo" onClick={() => void chooseCompanyPath("logoPath")}><FolderOpen aria-hidden="true" size={18} /></button></div></label>
          <label>Output directory<div className="path-input"><input value={company.outputDirectory} onChange={(event) => setCompany({ ...company, outputDirectory: event.target.value })} /><button className="icon-button" type="button" aria-label="Choose output directory" title="Choose output directory" onClick={() => void chooseCompanyPath("outputDirectory")}><FolderOpen aria-hidden="true" size={18} /></button></div></label>
          <label className="wide-field">Address<textarea rows={2} value={company.address} onChange={(event) => setCompany({ ...company, address: event.target.value })} /></label>
          <div className="form-actions"><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save company"}</button></div>
        </form>
      </section>

      <section className="documents-section" aria-labelledby="documents-heading">
        <div className="section-heading"><div><p className="eyebrow">Documents</p><h2 id="documents-heading">Invoices and quotes</h2></div><div className="document-actions"><span className="document-count">{visibleDocuments.length} of {documents.length}</span><button className="primary-button" type="button" onClick={openNewDocument}>New document</button></div></div>
        {isLoading ? <p className="empty-state">Loading local records...</p> : documents.length === 0 ? <p className="empty-state">No invoices or quotes yet.</p> : (
          <div className="table-wrap"><table><thead><tr>{(Object.keys(filterLabels) as FilterKey[]).map((key) => <th key={key}><div className="column-heading"><button type="button" onClick={() => toggleSort(key)}>{filterLabels[key]}{sort.key === key && (sort.direction === "ascending" ? <ArrowUpAZ aria-hidden="true" size={14} /> : <ArrowDownAZ aria-hidden="true" size={14} />)}</button><button className="header-filter-button" type="button" aria-label={`Filter ${filterLabels[key]}`} title={`Filter ${filterLabels[key]}`} onClick={() => setActiveFilter((current) => current === key ? null : key)}><ListFilter aria-hidden="true" size={14} /></button></div></th>)}<th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
            {visibleDocuments.map(({ record, clientName }) => { const { id, data } = record; const isPaid = data.paymentReceived; const proof = data.attachments[0]; return <tr key={id}><td>{data.invoiceNumber}</td><td>{data.documentType}</td><td>{data.issueDate}</td><td>{clientName}</td><td><span className={`status ${data.status}`}>{data.status}</span></td><td><label className="payment-checkbox" title={isPaid ? "Paid documents are locked" : "Upload payment proof and mark as paid"}><input type="checkbox" checked={isPaid} disabled={isPaid || updatingPaymentId === id} onChange={() => void markDocumentPaid(record)} /><span>{isPaid ? data.paymentReceivedDate ?? "Received" : "Outstanding"}</span></label></td><td>{formatMoney(data.totalCents, data.currency)}</td><td className="actions-cell"><div className="row-actions"><button className="icon-button" type="button" aria-label={`Edit ${data.invoiceNumber}`} title={isPaid ? "Paid documents cannot be edited" : "Edit document"} disabled={isPaid} onClick={() => openDocumentEditor(record)}><Pencil aria-hidden="true" size={18} /></button><button className="icon-button" type="button" aria-label={`Open proof for ${data.invoiceNumber}`} title={proof ? `Open proof: ${proof.originalFilename}` : "No payment proof"} disabled={!proof} onClick={() => void handleOpenProof(record)}><ExternalLink aria-hidden="true" size={18} /></button><button className="icon-button" type="button" aria-label={`Save ${data.invoiceNumber} as PDF`} title="Save PDF" disabled={savingPdfId === data.id} onClick={() => void handleSavePdf(data)}><FileDown aria-hidden="true" size={18} /></button><button className="icon-button delete-button" type="button" aria-label={`Delete ${data.invoiceNumber}`} title="Delete document and create backup" onClick={() => void handleDeleteDocument(record)}><Trash2 aria-hidden="true" size={18} /></button></div></td></tr>; })}
          </tbody></table></div>
        )}
      </section>
      {activeFilter && <div className="filter-tray"><label>Filter {filterLabels[activeFilter]}<input autoFocus value={filters[activeFilter]} onChange={(event) => updateFilter(activeFilter, event.target.value)} /></label><button className="refresh-button" type="button" onClick={() => updateFilter(activeFilter, "")}>Clear</button></div>}
      {isEditorOpen && <DocumentEditor key={editingRecord?.id ?? duplicateDocument?.invoiceNumber ?? "new"} company={company} defaultCurrency={company.defaultCurrency} suggestedInvoiceNumber={nextDocumentNumber(documents)} editingRecord={editingRecord ?? undefined} initialDocument={duplicateDocument ?? undefined} onClose={closeEditor} onSaved={loadDashboard} />}
    </main>
  );
}

export default App;
