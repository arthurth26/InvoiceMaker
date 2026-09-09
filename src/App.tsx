import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { pdf } from "@react-pdf/renderer";
import { ArrowDownAZ, ArrowLeft, ArrowRight, ArrowUpAZ, DatabaseBackup, ExternalLink, FileDown, FolderOpen, ListFilter, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { ask, open, save } from "@tauri-apps/plugin-dialog";

import { createManualBackup, deleteDocument, getCompany, getDatabaseLocations, listClients, listDocuments, openProof, restoreBackup, saveCompany, saveCsv, savePdf, setAutomaticBackupDirectory, storeProof, updateDocument } from "./services/invoiceRepository";
import ClientEditor from "./components/ClientEditor";
import DocumentEditor from "./components/DocumentEditor";
import InvoicePdf from "./components/InvoicePdf";
import type { BankAccount, Client, CompanyInfo, Document, StoredRecord } from "./types/invoice";
import "./App.css";

const defaultCompany: CompanyInfo = {
  name: "", address: "", email: "", phone: "", taxId: "", logoPath: null,
  defaultCurrency: "HKD", bankAccounts: [], defaultBankAccountId: null, outputDirectory: "",
};

const emptyBankAccount = (): BankAccount => ({ id: crypto.randomUUID(), nickname: "", institution: "", accountNumber: "" });

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountCents / 100);
}

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type FilterKey = "invoiceNumber" | "documentType" | "issueDate" | "dueDate" | "client" | "status" | "payment" | "total";
type SortDirection = "ascending" | "descending";
const pageSizes = [25, 50, 100] as const;
const editableStatuses = ["draft", "sent", "accepted"] as const;

const filterLabels: Record<FilterKey, string> = {
  invoiceNumber: "Number", documentType: "Type", issueDate: "Issue date", dueDate: "Due date", client: "Client",
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
  const [databaseDirectory, setDatabaseDirectory] = useState("");
  const [backupDirectory, setBackupDirectory] = useState("");
  const [isChangingBackupDirectory, setIsChangingBackupDirectory] = useState(false);
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof listDocuments>>>([]);
  const [clients, setClients] = useState<StoredRecord<Client>[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isClientEditorOpen, setIsClientEditorOpen] = useState(false);
  const [isBankAccountManagerOpen, setIsBankAccountManagerOpen] = useState(false);
  const [newBankAccount, setNewBankAccount] = useState<BankAccount>(emptyBankAccount);
  const [editingBankAccountId, setEditingBankAccountId] = useState<string | null>(null);
  const [bankAccountDraft, setBankAccountDraft] = useState<BankAccount | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingPdfId, setSavingPdfId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<StoredRecord<Document> | null>(null);
  const [duplicateDocument, setDuplicateDocument] = useState<Document | null>(null);
  const [updatingPaymentId, setUpdatingPaymentId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ invoiceNumber: "", documentType: "", issueDate: "", dueDate: "", client: "", status: "", payment: "", total: "" });
  const [sort, setSort] = useState<{ key: FilterKey; direction: SortDirection }>({ key: "issueDate", direction: "descending" });
  const [pageSize, setPageSize] = useState<(typeof pageSizes)[number]>(25);
  const [currentPage, setCurrentPage] = useState(1);

  const documentRows = documents.map((record) => ({ record, clientName: clients.find((client) => client.id === record.data.clientId)?.data.name ?? "Unknown client" }));
  const visibleDocuments = documentRows
    .filter(({ record, clientName }) => {
      const values: Record<FilterKey, string> = {
        invoiceNumber: record.data.invoiceNumber, documentType: record.data.documentType, issueDate: record.data.issueDate, dueDate: record.data.dueDate ?? "",
        client: clientName, status: record.data.status, payment: record.data.paymentReceived ? "received" : "outstanding",
        total: formatMoney(record.data.totalCents, record.data.currency),
      };
      return (Object.keys(filters) as FilterKey[]).every((key) => values[key].toLowerCase().includes(filters[key].toLowerCase()));
    })
    .sort((left, right) => {
      const leftValue = sort.key === "client" ? left.clientName : sort.key === "total" ? left.record.data.totalCents : sort.key === "payment" ? Number(left.record.data.paymentReceived) : left.record.data[sort.key === "invoiceNumber" ? "invoiceNumber" : sort.key === "documentType" ? "documentType" : sort.key === "issueDate" ? "issueDate" : sort.key === "dueDate" ? "dueDate" : "status"] ?? "";
      const rightValue = sort.key === "client" ? right.clientName : sort.key === "total" ? right.record.data.totalCents : sort.key === "payment" ? Number(right.record.data.paymentReceived) : right.record.data[sort.key === "invoiceNumber" ? "invoiceNumber" : sort.key === "documentType" ? "documentType" : sort.key === "issueDate" ? "issueDate" : sort.key === "dueDate" ? "dueDate" : "status"] ?? "";
      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
      return sort.direction === "ascending" ? comparison : -comparison;
    });
  const pageCount = Math.max(1, Math.ceil(visibleDocuments.length / pageSize));
  const currentPageDocuments = visibleDocuments.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, pageCount));
  }, [pageCount]);

  useEffect(() => { void loadDashboard(); }, []);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);
    try {
      const [savedCompany, savedDocuments, savedClients, locations] = await Promise.all([getCompany(), listDocuments(), listClients(), getDatabaseLocations()]);
      setCompanyRecord(savedCompany);
      setCompany(savedCompany?.data ?? defaultCompany);
      setDocuments(savedDocuments);
      setClients(savedClients);
      setDatabaseDirectory(locations.databaseDirectory);
      setBackupDirectory(locations.backupDirectory);
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

  async function handleChooseBackupDirectory() {
    const directory = await open({ directory: true, multiple: false, title: "Choose automatic database backup directory" });
    if (typeof directory !== "string") return;

    setIsChangingBackupDirectory(true);
    setError(null);
    try {
      await setAutomaticBackupDirectory(directory);
      setBackupDirectory(directory);
      setSuccessMessage("Automatic database backup directory updated.");
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : "Unable to change the automatic backup directory.");
    } finally { setIsChangingBackupDirectory(false); }
  }

  async function handleRestoreBackup() {
    const source = await open({ directory: false, multiple: false, title: "Choose database backup", filters: [{ name: "SQLite database", extensions: ["db"] }] });
    if (typeof source !== "string") return;
    const confirmed = await ask("Restoring replaces the active database after backing it up. The app will restart. Continue?", { kind: "warning", title: "Restore database backup" });
    if (!confirmed) return;

    setIsRestoring(true);
    setError(null);
    try {
      await restoreBackup(source);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Unable to restore database backup.");
      setIsRestoring(false);
    }
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

  async function handleExportCsv() {
    setSuccessMessage(null);
    setError(null);
    const destination = await save({
      defaultPath: `invoices-and-quotes-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV file", extensions: ["csv"] }],
    });
    if (!destination) return;

    const rows = [
      ["Number", "Type", "Issue date", "Due date", "Client", "Status", "Payment", "Total"],
      ...visibleDocuments.map(({ record, clientName }) => {
        const { data } = record;
        return [data.invoiceNumber, data.documentType, data.issueDate, data.dueDate ?? "", clientName, data.status, data.paymentReceived ? data.paymentReceivedDate ?? "Received" : "Outstanding", formatMoney(data.totalCents, data.currency)];
      }),
    ];

    setIsExportingCsv(true);
    try {
      const contents = `\uFEFF${rows.map((row) => row.map((value) => `"${value.replace(/"/g, "\"\"")}"`).join(",")).join("\r\n")}`;
      await saveCsv(destination, contents);
      setSuccessMessage(`All ${visibleDocuments.length} filtered table rows exported as CSV.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export CSV.");
    } finally { setIsExportingCsv(false); }
  }

  function openNewDocument() {
    setEditingRecord(null);
    setDuplicateDocument(null);
    setIsEditorOpen(true);
  }

  function updateFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
  }

  function toggleSort(key: FilterKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
      : { key, direction: "ascending" });
    setCurrentPage(1);
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

  async function updateDocumentStatus(record: StoredRecord<Document>, status: (typeof editableStatuses)[number]) {
    setError(null);
    try {
      await updateDocument({ ...record, updatedAt: new Date().toISOString(), data: { ...record.data, status } });
      await loadDashboard();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Unable to update document status.");
    }
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

  async function persistCompany(nextCompany: CompanyInfo) {
    setIsSaving(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const record: StoredRecord<CompanyInfo> = {
      id: "company", recordKind: "company", createdAt: companyRecord?.createdAt ?? timestamp,
      updatedAt: timestamp, data: nextCompany,
    };
    try {
      await saveCompany(record);
      setCompany(nextCompany);
      setCompanyRecord(record);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save company details.");
      throw saveError;
    } finally { setIsSaving(false); }
  }

  async function addBankAccount() {
    if (!newBankAccount.nickname.trim() || !newBankAccount.institution.trim() || !newBankAccount.accountNumber.trim()) return;
    const nextCompany = { ...company, bankAccounts: [...company.bankAccounts, newBankAccount] };
    try {
      await persistCompany(nextCompany);
      setNewBankAccount(emptyBankAccount());
    } catch { /* The shared save path shows the error. */ }
  }

  function beginBankAccountEdit(account: BankAccount) {
    setEditingBankAccountId(account.id);
    setBankAccountDraft({ ...account });
  }

  function updateBankAccountDraft(field: keyof Omit<BankAccount, "id">, value: string) {
    setBankAccountDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function saveBankAccountEdit() {
    if (!bankAccountDraft) return;
    const nextCompany = { ...company, bankAccounts: company.bankAccounts.map((account) => account.id === bankAccountDraft.id ? bankAccountDraft : account) };
    try {
      await persistCompany(nextCompany);
      setEditingBankAccountId(null);
      setBankAccountDraft(null);
    } catch { /* Keep the draft open so the user can retry. */ }
  }

  async function removeBankAccount(id: string) {
    const nextCompany = {
      ...company,
      bankAccounts: company.bankAccounts.filter((account) => account.id !== id),
      defaultBankAccountId: company.defaultBankAccountId === id ? null : company.defaultBankAccountId,
    };
    try { await persistCompany(nextCompany); } catch { /* The shared save path shows the error. */ }
  }

  function hasBankAccountDraftChanges() {
    const savedAccount = company.bankAccounts.find((account) => account.id === bankAccountDraft?.id);
    return Boolean(bankAccountDraft && savedAccount && (
      bankAccountDraft.nickname !== savedAccount.nickname
      || bankAccountDraft.institution !== savedAccount.institution
      || bankAccountDraft.accountNumber !== savedAccount.accountNumber
    ));
  }

  function hasNewBankAccountChanges() {
    return Boolean(newBankAccount.nickname || newBankAccount.institution || newBankAccount.accountNumber);
  }

  async function closeBankAccountManager() {
    if (hasBankAccountDraftChanges() || hasNewBankAccountChanges()) {
      const shouldSave = await ask("You have unsaved bank account changes. Save them before closing?", { kind: "warning", title: "Unsaved bank account changes" });
      if (shouldSave) {
        if (hasNewBankAccountChanges() && (!newBankAccount.nickname.trim() || !newBankAccount.institution.trim() || !newBankAccount.accountNumber.trim())) {
          setError("Complete the new bank account before saving.");
          return;
        }
        await saveBankAccountEdit();
        await addBankAccount();
      }
    }
    setEditingBankAccountId(null);
    setBankAccountDraft(null);
    setNewBankAccount(emptyBankAccount());
    setIsBankAccountManagerOpen(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-title"><div><p className="eyebrow">Local ledger</p><h1>Invoice Maker</h1></div><label className="database-location">Database files and automatic backups<div className="path-input"><input readOnly value={databaseDirectory === backupDirectory ? databaseDirectory : `Files: ${databaseDirectory} | Backups: ${backupDirectory}`} aria-label="Database files and automatic backup directories" title={databaseDirectory === backupDirectory ? databaseDirectory : `Database files: ${databaseDirectory}\nAutomatic backups: ${backupDirectory}`} /><button className="icon-button" type="button" aria-label="Choose automatic database backup directory" title="Choose automatic database backup directory" disabled={isChangingBackupDirectory} onClick={() => void handleChooseBackupDirectory()}><FolderOpen aria-hidden="true" size={18} /></button></div></label></div>
        <div className="topbar-actions">
          <button className="refresh-button" type="button" onClick={() => void loadDashboard()}>Refresh</button>
          <button className="icon-button" type="button" aria-label="Restore database backup" title="Restore database backup" disabled={isRestoring} onClick={() => void handleRestoreBackup()}><RotateCcw aria-hidden="true" size={18} /></button>
          <button className="icon-button" type="button" aria-label="Create database backup" title="Create database backup" disabled={isBackingUp} onClick={() => void handleCreateBackup()}><DatabaseBackup aria-hidden="true" size={18} /></button>
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
          <label>Logo file<div className="path-input"><input value={company.logoPath ?? ""} onChange={(event) => setCompany({ ...company, logoPath: event.target.value || null })} /><button className="icon-button" type="button" aria-label="Choose company logo" title="Choose company logo" onClick={() => void chooseCompanyPath("logoPath")}><FolderOpen aria-hidden="true" size={18} /></button></div></label>
          <label>Output directory<div className="path-input"><input value={company.outputDirectory} onChange={(event) => setCompany({ ...company, outputDirectory: event.target.value })} /><button className="icon-button" type="button" aria-label="Choose output directory" title="Choose output directory" onClick={() => void chooseCompanyPath("outputDirectory")}><FolderOpen aria-hidden="true" size={18} /></button></div></label>
          <label className="wide-field">Address<textarea rows={2} value={company.address} onChange={(event) => setCompany({ ...company, address: event.target.value })} /></label>
          <div className="company-payment-settings wide-field">
            <label>Default currency<select value={company.defaultCurrency} onChange={(event) => setCompany({ ...company, defaultCurrency: event.target.value })}><option value="HKD">HKD</option><option value="USD">USD</option></select></label>
            <label>Bank account<select value={company.defaultBankAccountId ?? ""} onChange={(event) => setCompany({ ...company, defaultBankAccountId: event.target.value || null })}><option value="">No account selected</option>{company.bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.nickname} - {account.accountNumber}</option>)}</select></label>
            <button className="icon-button bank-account-manager-button" type="button" aria-label="Manage bank accounts" title="Manage bank accounts" onClick={() => setIsBankAccountManagerOpen(true)}><Plus aria-hidden="true" size={18} /></button>
          </div>
          <div className="form-actions"><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save Company Info"}</button></div>
        </form>
      </section>

      <section className="documents-section" aria-labelledby="documents-heading">
        <div className="section-heading"><div><p className="eyebrow">Documents</p><h2 id="documents-heading">Invoices and quotes</h2></div><div className="document-actions"><button className="refresh-button" type="button" onClick={() => setIsClientEditorOpen(true)}>Manage clients</button><span className="document-count">{visibleDocuments.length} of {documents.length}</span><button className="primary-button" type="button" onClick={openNewDocument}>New document</button></div></div>
        {isLoading ? <p className="empty-state">Loading local records...</p> : documents.length === 0 ? <p className="empty-state">No invoices or quotes yet.</p> : (
          <div>
            <div className="table-wrap"><table><thead><tr>{(Object.keys(filterLabels) as FilterKey[]).map((key) => <th key={key}><div className="column-heading"><button type="button" onClick={() => toggleSort(key)}>{filterLabels[key]}{sort.key === key && (sort.direction === "ascending" ? <ArrowUpAZ aria-hidden="true" size={14} /> : <ArrowDownAZ aria-hidden="true" size={14} />)}</button><button className="header-filter-button" type="button" aria-label={`Filter ${filterLabels[key]}`} title={`Filter ${filterLabels[key]}`} onClick={() => setActiveFilter((current) => current === key ? null : key)}><ListFilter aria-hidden="true" size={14} /></button></div></th>)}<th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
            {currentPageDocuments.map(({ record, clientName }) => { const { id, data } = record; const isPaid = data.paymentReceived; const proof = data.attachments[0]; return <tr key={id}><td>{data.invoiceNumber}</td><td>{data.documentType}</td><td>{data.issueDate}</td><td>{data.dueDate ?? "-"}</td><td>{clientName}</td><td>{isPaid ? <span className="status paid">paid</span> : <select className="status-select" aria-label={`Status for ${data.invoiceNumber}`} value={editableStatuses.includes(data.status as (typeof editableStatuses)[number]) ? data.status : "draft"} onChange={(event) => void updateDocumentStatus(record, event.target.value as (typeof editableStatuses)[number])}>{editableStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>}</td><td><label className="payment-checkbox" title={isPaid ? "Paid documents are locked" : "Upload payment proof and mark as paid"}><input type="checkbox" checked={isPaid} disabled={isPaid || updatingPaymentId === id} onChange={() => void markDocumentPaid(record)} /><span>{isPaid ? data.paymentReceivedDate ?? "Received" : "Outstanding"}</span></label></td><td>{formatMoney(data.totalCents, data.currency)}</td><td className="actions-cell"><div className="row-actions"><button className="icon-button" type="button" aria-label={`Edit ${data.invoiceNumber}`} title={isPaid ? "Paid documents cannot be edited" : "Edit document"} disabled={isPaid} onClick={() => openDocumentEditor(record)}><Pencil aria-hidden="true" size={18} /></button><button className="icon-button" type="button" aria-label={`Open proof for ${data.invoiceNumber}`} title={proof ? `Open proof: ${proof.originalFilename}` : "No payment proof"} disabled={!proof} onClick={() => void handleOpenProof(record)}><ExternalLink aria-hidden="true" size={18} /></button><button className="icon-button" type="button" aria-label={`Save ${data.invoiceNumber} as PDF`} title="Save PDF" disabled={savingPdfId === data.id} onClick={() => void handleSavePdf(data)}><FileDown aria-hidden="true" size={18} /></button><button className="icon-button delete-button" type="button" aria-label={`Delete ${data.invoiceNumber}`} title="Delete document and create backup" onClick={() => void handleDeleteDocument(record)}><Trash2 aria-hidden="true" size={18} /></button></div></td></tr>; })}
          </tbody></table></div>
          <div className="pagination-controls">
            <label>Rows per page<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as (typeof pageSizes)[number]); setCurrentPage(1); }}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
            <span>{visibleDocuments.length === 0 ? "0 results" : `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, visibleDocuments.length)} of ${visibleDocuments.length}`}</span>
            <div className="pagination-buttons">
              <button className="icon-button" type="button" aria-label="Previous page" title="Previous page" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}><ArrowLeft aria-hidden="true" size={18} /></button>
              <span>Page {currentPage} of {pageCount}</span>
              <button className="icon-button" type="button" aria-label="Next page" title="Next page" disabled={currentPage === pageCount} onClick={() => setCurrentPage((page) => page + 1)}><ArrowRight aria-hidden="true" size={18} /></button>
            </div>
          </div>
          <div className="table-footer"><button className="refresh-button export-csv-button" type="button" disabled={isExportingCsv} onClick={() => void handleExportCsv()}><FileDown aria-hidden="true" size={16} />{isExportingCsv ? "Exporting..." : "Export CSV"}</button></div>
          </div>
        )}
      </section>
      {activeFilter && <div className="filter-tray"><label>Filter {filterLabels[activeFilter]}<input autoFocus value={filters[activeFilter]} onChange={(event) => updateFilter(activeFilter, event.target.value)} /></label><button className="refresh-button" type="button" onClick={() => updateFilter(activeFilter, "")}>Clear</button></div>}
      {isClientEditorOpen && <ClientEditor clients={clients} onClose={() => setIsClientEditorOpen(false)} onSaved={loadDashboard} />}
      {isBankAccountManagerOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => void closeBankAccountManager()}><section className="bank-account-modal" role="dialog" aria-modal="true" aria-labelledby="bank-accounts-heading" onMouseDown={(event) => event.stopPropagation()}>
        <div className="editor-header"><div><p className="eyebrow">Payment settings</p><h2 id="bank-accounts-heading">Bank accounts</h2></div><button className="icon-button" type="button" aria-label="Close bank account manager" title="Close" onClick={() => void closeBankAccountManager()}>x</button></div>
        <div className="table-wrap bank-account-table-wrap"><table className="bank-account-table"><thead><tr><th>Nickname</th><th>Account institution</th><th>Bank account ID</th><th>Actions</th></tr></thead><tbody>{company.bankAccounts.map((account) => { const isEditing = editingBankAccountId === account.id; const displayedAccount = isEditing && bankAccountDraft ? bankAccountDraft : account; return <tr key={account.id}><td><input aria-label={`Nickname for ${account.accountNumber}`} readOnly={!isEditing} value={displayedAccount.nickname} onChange={(event) => updateBankAccountDraft("nickname", event.target.value)} /></td><td><input aria-label={`Institution for ${account.accountNumber}`} readOnly={!isEditing} value={displayedAccount.institution} onChange={(event) => updateBankAccountDraft("institution", event.target.value)} /></td><td><input aria-label={`Account ID for ${account.nickname || account.accountNumber}`} readOnly={!isEditing} value={displayedAccount.accountNumber} onChange={(event) => updateBankAccountDraft("accountNumber", event.target.value)} /></td><td className="actions-cell"><div className="row-actions"><button className="icon-button" type="button" aria-label={isEditing ? `Save ${account.nickname || account.accountNumber}` : `Modify ${account.nickname || account.accountNumber}`} title={isEditing ? "Save account" : "Modify account"} disabled={isSaving || (!isEditing && Boolean(bankAccountDraft))} onClick={() => void (isEditing ? saveBankAccountEdit() : beginBankAccountEdit(account))}>{isEditing ? <Save aria-hidden="true" size={18} /> : <Pencil aria-hidden="true" size={18} />}</button><button className="icon-button delete-button" type="button" aria-label={`Delete ${account.nickname || account.accountNumber}`} title="Delete account" disabled={isSaving || Boolean(bankAccountDraft)} onClick={() => void removeBankAccount(account.id)}><Trash2 aria-hidden="true" size={18} /></button></div></td></tr>; })}<tr className="new-bank-account-row"><td><input aria-label="New account nickname" placeholder="Nickname" value={newBankAccount.nickname} onChange={(event) => setNewBankAccount({ ...newBankAccount, nickname: event.target.value })} /></td><td><input aria-label="New account institution" placeholder="Institution" value={newBankAccount.institution} onChange={(event) => setNewBankAccount({ ...newBankAccount, institution: event.target.value })} /></td><td><input aria-label="New bank account ID" placeholder="Account ID" value={newBankAccount.accountNumber} onChange={(event) => setNewBankAccount({ ...newBankAccount, accountNumber: event.target.value })} /></td><td className="actions-cell"><div className="row-actions"><button className="icon-button" type="button" aria-label="Add bank account" title="Add bank account" disabled={isSaving} onClick={() => void addBankAccount()}><Plus aria-hidden="true" size={18} /></button></div></td></tr></tbody></table></div>
        <div className="editor-footer"><p className="saved-state">Save company details to keep account changes.</p><button className="primary-button" type="button" onClick={() => void closeBankAccountManager()}>Done</button></div>
      </section></div>}
      {isEditorOpen && <DocumentEditor key={editingRecord?.id ?? duplicateDocument?.invoiceNumber ?? "new"} company={company} defaultCurrency={company.defaultCurrency} suggestedInvoiceNumber={nextDocumentNumber(documents)} editingRecord={editingRecord ?? undefined} initialDocument={duplicateDocument ?? undefined} onClose={closeEditor} onSaved={loadDashboard} />}
    </main>
  );
}

export default App;
