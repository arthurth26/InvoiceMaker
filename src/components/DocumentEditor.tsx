import { useEffect, useState } from "react";
import type { ComponentProps } from "react";
import { pdf } from "@react-pdf/renderer";
import { ask, open } from "@tauri-apps/plugin-dialog";

import InvoicePdf from "./InvoicePdf";
import { createDocument, listClients, replaceClient, saveClient, savePdf, updateDocument } from "../services/invoiceRepository";
import type { Client, CompanyInfo, Document, DocumentStatus, DocumentType, LineItem, StoredRecord } from "../types/invoice";

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
    const [clients, setClients] = useState<StoredRecord<Client>[]>([]);
    const [clientId, setClientId] = useState(sourceDocument?.clientId ?? "");
    const [isAddingClient, setIsAddingClient] = useState(false);
    const [newClientName, setNewClientName] = useState("");
    const [newClientAddress, setNewClientAddress] = useState("");
    const [newClientEmail, setNewClientEmail] = useState("");
    const [newClientPhone, setNewClientPhone] = useState("");
    const [documentType, setDocumentType] = useState<DocumentType>(sourceDocument?.documentType ?? "invoice");
    const [invoiceNumber, setInvoiceNumber] = useState(sourceDocument?.invoiceNumber ?? suggestedInvoiceNumber ?? "");
    const [issueDate, setIssueDate] = useState(sourceDocument?.issueDate ?? new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState(sourceDocument?.dueDate ?? "");
    const [currency, setCurrency] = useState(sourceDocument?.currency ?? defaultCurrency);
    const [status, setStatus] = useState<DocumentStatus>(sourceDocument?.status ?? "draft");
    const [paymentReceived, setPaymentReceived] = useState(sourceDocument?.paymentReceived ?? false);
    const [paymentReceivedDate, setPaymentReceivedDate] = useState(sourceDocument?.paymentReceivedDate ?? "");
    const [notes, setNotes] = useState(sourceDocument?.notes ?? "");
    const [lineItems, setLineItems] = useState<LineItem[]>(sourceDocument?.lineItems ?? [emptyLineItem()]);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => { void loadClients(); }, []);

    async function loadClients() {
        try { setClients(await listClients()); } catch { setError("Unable to load clients."); }
    }

    async function addClient() {
        if (!newClientName.trim()) return;
        const timestamp = new Date().toISOString();
        const id = crypto.randomUUID();
        const record: StoredRecord<Client> = {
            id, recordKind: "client", createdAt: timestamp, updatedAt: timestamp,
            data: { id, name: newClientName.trim(), address: newClientAddress.trim(), email: newClientEmail.trim(), phone: newClientPhone.trim(), taxId: null },
        };
        try {
            await saveClient(record);
        } catch (saveError) {
            const isCrossKindCollision = saveError instanceof Error && saveError.message.includes("record ID belongs to another record type");
            if (!isCrossKindCollision) { setError("Unable to save the new client."); return; }

            const shouldReplace = await ask(
                "This client ID belongs to a different record. Replacing it removes that record after creating a database backup.",
                { kind: "warning", title: "Replace existing record" },
            );
            if (!shouldReplace) return;

            try {
                await replaceClient(record);
            } catch {
                setError("Unable to replace the existing record.");
                return;
            }
        }

        setClients((current) => [...current, record]);
        setClientId(id);
        setNewClientName("");
        setNewClientAddress("");
        setNewClientEmail("");
        setNewClientPhone("");
        setIsAddingClient(false);
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
        setIsSaving(true);
        setError(null);
        const timestamp = new Date().toISOString();
        const id = editingRecord?.id ?? crypto.randomUUID();
        const effectiveStatus = paymentReceived ? "paid" : status === "paid" ? "invoiced" : status;
        const persistedInvoiceNumber = isEditing || initialDocument ? invoiceNumber.trim() : initialRevision(invoiceNumber.trim());
        const data: Document = {
            id, invoiceNumber: persistedInvoiceNumber, documentType, clientId, status: effectiveStatus, issueDate,
            dueDate: dueDate || null, currency, lineItems, subtotalCents, taxAmountCents, totalCents,
            paymentReceived, paymentReceivedDate: paymentReceived ? paymentReceivedDate || issueDate : null,
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
                    <button className="link-button" type="button" onClick={() => setIsAddingClient((value) => !value)}>{isAddingClient ? "Cancel new client" : "Add new client"}</button>
                    {isAddingClient && <div className="new-client"><input value={newClientName} onChange={(event) => setNewClientName(event.target.value)} placeholder="Client name" /><input value={newClientEmail} onChange={(event) => setNewClientEmail(event.target.value)} placeholder="Email" type="email" /><input value={newClientPhone} onChange={(event) => setNewClientPhone(event.target.value)} placeholder="Phone" /><input value={newClientAddress} onChange={(event) => setNewClientAddress(event.target.value)} placeholder="Address" /><button type="button" onClick={() => void addClient()}>Add</button></div>}
                    <label>Issue date<input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
                    <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
                    <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>HKD</option><option>USD</option></select></label>
                    <label>Status<select value={paymentReceived ? "paid" : status} disabled={paymentReceived} onChange={(event) => setStatus(event.target.value as DocumentStatus)}><option value="draft">Draft</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="invoiced">Invoiced</option></select></label>
                    <label className="payment-toggle"><input type="checkbox" checked={paymentReceived} onChange={(event) => { const received = event.target.checked; setPaymentReceived(received); if (received) setPaymentReceivedDate((current) => current || new Date().toISOString().slice(0, 10)); }} />Payment received</label>
                    {paymentReceived && <label>Payment date<input required type="date" value={paymentReceivedDate} onChange={(event) => setPaymentReceivedDate(event.target.value)} /></label>}
                </div>
                <div className="line-items"><div className="line-items-heading"><h3>Line items</h3><button className="link-button" type="button" onClick={() => setLineItems((current) => [...current, emptyLineItem()])}>Add line</button></div><div className="line-item line-item-labels"><span>Description</span><span>Quantity</span><span>Unit price</span><span aria-hidden="true"></span></div>
                    {lineItems.map((item, index) => <div className="line-item" key={index}>
                        <input aria-label={`Description ${index + 1}`} value={item.description} onChange={(event) => updateLineItem(index, { description: event.target.value })} placeholder="Description" />
                        <input aria-label={`Quantity ${index + 1}`} type="number" min="0.001" step="0.001" value={item.quantityMilliunits / 1000} onChange={(event) => updateLineItem(index, { quantityMilliunits: Math.round((Number(event.target.value) || 0) * 1000) })} />
                        <input aria-label={`Unit price ${index + 1}`} type="number" min="0" step="0.01" value={item.unitPriceCents / 100} onChange={(event) => updateLineItem(index, { unitPriceCents: centsFromInput(event.target.value) })} />
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