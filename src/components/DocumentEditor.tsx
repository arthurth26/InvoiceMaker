import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { pdf } from "@react-pdf/renderer";
import { open } from "@tauri-apps/plugin-dialog";

import InvoicePdf from "./InvoicePdf";
import { createDocument, listClients, savePdf, updateDocument } from "../services/invoiceRepository";
import type { Client, CompanyInfo, Document, DocumentType, LineItem, StoredRecord } from "../types/invoice";

interface DocumentEditorProps {
    company: CompanyInfo;
    defaultCurrency: string;
    suggestedInvoiceNumber?: string;
    editingRecord?: StoredRecord<Document>;
    initialDocument?: Document;
    onClose: () => void;
    onSaved: () => Promise<void>;
}

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;

const emptyLineItem = (): LineItem => ({
    description: "",
    quantityMilliunits: 1000,
    unitPriceCents: 0,
    taxRateBasisPoints: 0,
    discountCents: 0,
});

function centsFromInput(value: string) {
    return Math.round((Number(value) || 0) * 100);
}

function initialRevision(invoiceNumber: string) {
    return /-\d{2}$/.test(invoiceNumber) ? invoiceNumber : `${invoiceNumber}-00`;
}

function DocumentEditor({ company, defaultCurrency, suggestedInvoiceNumber, editingRecord, initialDocument, onClose, onSaved }: DocumentEditorProps) {
    const sourceDocument = editingRecord?.data ?? initialDocument;
    const isEditing = Boolean(editingRecord);
    const minimumDueDate = editingRecord?.createdAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const [clients, setClients] = useState<StoredRecord<Client>[]>([]);
    const [clientId, setClientId] = useState(sourceDocument?.clientId ?? "");
    const [documentType, setDocumentType] = useState<DocumentType>(sourceDocument?.documentType ?? "invoice");
    const [invoiceNumber, setInvoiceNumber] = useState(sourceDocument?.invoiceNumber ?? suggestedInvoiceNumber ?? "");
    const [issueDate, setIssueDate] = useState(sourceDocument?.issueDate ?? new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState(editingRecord?.data.dueDate ?? minimumDueDate);
    const [currency, setCurrency] = useState(sourceDocument?.currency ?? defaultCurrency);
    const [notes, setNotes] = useState(sourceDocument?.notes ?? "");
    const [lineItems, setLineItems] = useState<LineItem[]>(sourceDocument?.lineItems ?? [emptyLineItem()]);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => { void loadClients(); }, []);

    async function loadClients() {
        try { setClients(await listClients()); } catch { setError("Unable to load clients."); }
    }

    function updateLineItem(index: number, update: Partial<LineItem>) {
        setLineItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
    }

    const subtotalCents = lineItems.reduce((total, item) => total + Math.round(item.quantityMilliunits * item.unitPriceCents / 1000) - item.discountCents, 0);
    const taxAmountCents = 0;
    const totalCents = subtotalCents + taxAmountCents;

    const saveDocument: FormSubmitHandler = async (event) => {
        event.preventDefault();
        if (!clientId) { setError("Choose or add a client before saving."); return; }
        if (!invoiceNumber.trim()) { setError("Enter a document number before saving."); return; }
        if (lineItems.some((item) => !item.description.trim())) { setError("Each line item needs a description."); return; }
        if (dueDate < minimumDueDate) { setError("Due date cannot be before the document creation date."); return; }
        setIsSaving(true);
        setError(null);
        const timestamp = new Date().toISOString();
        const id = editingRecord?.id ?? crypto.randomUUID();
        const persistedInvoiceNumber = isEditing || initialDocument ? invoiceNumber.trim() : initialRevision(invoiceNumber.trim());
        const data: Document = {
            id, invoiceNumber: persistedInvoiceNumber, documentType, clientId, status: sourceDocument?.status ?? "draft", issueDate,
            dueDate: dueDate || null, currency, lineItems, subtotalCents, taxAmountCents, totalCents,
            paymentReceived: sourceDocument?.paymentReceived ?? false, paymentReceivedDate: sourceDocument?.paymentReceivedDate ?? null,
            attachments: sourceDocument?.attachments ?? [], notes: notes || null,
        };
        try {
            const record: StoredRecord<Document> = {
                id, recordKind: "document", createdAt: editingRecord?.createdAt ?? timestamp, updatedAt: timestamp, data,
            };
            if (isEditing) await updateDocument(record);
            else await createDocument(record);
            if (!isEditing && documentType === "invoice") {
                const outputDirectory = company.outputDirectory || await open({
                    directory: true,
                    multiple: false,
                    title: "Choose invoice PDF output directory",
                });
                if (typeof outputDirectory !== "string") {
                    await onSaved();
                    onClose();
                    return;
                }
                const client = clients.find((clientRecord) => clientRecord.id === clientId)?.data ?? null;
                const blob = await pdf(<InvoicePdf company={company} client={client} document={data} />).toBlob();
                const contents = Array.from(new Uint8Array(await blob.arrayBuffer()));
                const separator = outputDirectory.endsWith("\\") || outputDirectory.endsWith("/") ? "" : "\\";
                await savePdf(`${outputDirectory}${separator}${data.invoiceNumber}.pdf`, contents);
            }
            await onSaved();
            onClose();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to save the document.");
        } finally { setIsSaving(false); }
    };

    return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
        <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="editor-header"><div><p className="eyebrow">{isEditing ? "Edit document" : initialDocument ? "Duplicate document" : "New document"}</p><h2 id="editor-title">Invoice or quote</h2></div><button className="close-button" type="button" aria-label="Close editor" onClick={onClose}>X</button></header>
            <form onSubmit={saveDocument}>
                {error && <p className="notice error" role="alert">{error}</p>}
                <div className="editor-grid">
                    <label>Type<div className="type-toggle"><button className={documentType === "invoice" ? "selected" : ""} type="button" onClick={() => setDocumentType("invoice")}>Invoice</button><button className={documentType === "quote" ? "selected" : ""} type="button" onClick={() => setDocumentType("quote")}>Quote</button></div></label>
                    <label>Document number<input required readOnly={!sourceDocument} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="INV-2026-001-00" /></label>
                    <label>Client<select required value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.data.name}</option>)}</select></label>
                    <label>Issue date<input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
                    <label>Due date<input required min={minimumDueDate} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
                    <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>HKD</option><option>USD</option></select></label>
                </div>
                <div className="line-items"><div className="line-items-heading"><h3>Line items</h3><button className="link-button" type="button" onClick={() => setLineItems((current) => [...current, emptyLineItem()])}>Add line</button></div><div className="line-item line-item-labels"><span>Description</span><span>Quantity</span><span>Unit price</span><span aria-hidden="true"></span></div>
                    {lineItems.map((item, index) => <div className="line-item" key={index}>
                        <input aria-label={`Description ${index + 1}`} value={item.description} onChange={(event) => updateLineItem(index, { description: event.target.value })} placeholder="Description" />
                        <input aria-label={`Quantity ${index + 1}`} type="number" min="1" step="1" value={item.quantityMilliunits / 1000} onChange={(event) => updateLineItem(index, { quantityMilliunits: Math.round((Number(event.target.value) || 0) * 1000) })} />
                        <input aria-label={`Unit price ${index + 1}`} type="number" min="0" step="0.1" value={item.unitPriceCents / 100} onChange={(event) => updateLineItem(index, { unitPriceCents: centsFromInput(event.target.value) })} />
                        <button className="remove-button" type="button" aria-label={`Remove line ${index + 1}`} disabled={lineItems.length === 1} onClick={() => setLineItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                    </div>)}
                </div>
                <label className="notes-field">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
                <div className="editor-footer"><dl><div><dt>Subtotal</dt><dd>{(subtotalCents / 100).toFixed(2)} {currency}</dd></div><div><dt>Total</dt><dd>{(totalCents / 100).toFixed(2)} {currency}</dd></div></dl><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : isEditing ? "Save changes" : `Save ${documentType}`}</button></div>
            </form>
        </section>
    </div>;
}

export default DocumentEditor;