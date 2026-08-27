import { useEffect, useState } from "react";
import type { ComponentProps } from "react";

import { createDocument, listClients, saveClient } from "../services/invoiceRepository";
import type { Client, Document, DocumentType, LineItem, StoredRecord } from "../types/invoice";

interface DocumentEditorProps {
  defaultCurrency: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
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

function DocumentEditor({ defaultCurrency, onClose, onCreated }: DocumentEditorProps) {
  const [clients, setClients] = useState<StoredRecord<Client>[]>([]);
  const [clientId, setClientId] = useState("");
  const [isAddingClient, setIsAddingClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("invoice");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLineItem()]);
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
      data: { id, name: newClientName.trim(), address: "", email: "", phone: "", taxId: null },
    };
    try {
      await saveClient(record);
      setClients((current) => [...current, record]);
      setClientId(id);
      setNewClientName("");
      setIsAddingClient(false);
    } catch { setError("Unable to save the new client."); }
  }

  function updateLineItem(index: number, update: Partial<LineItem>) {
    setLineItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
  }

  const subtotalCents = lineItems.reduce((total, item) => total + Math.round(item.quantityMilliunits * item.unitPriceCents / 1000) - item.discountCents, 0);
  const taxAmountCents = lineItems.reduce((total, item) => total + Math.round((Math.round(item.quantityMilliunits * item.unitPriceCents / 1000) - item.discountCents) * item.taxRateBasisPoints / 10000), 0);
  const totalCents = subtotalCents + taxAmountCents;

  const saveDocument: FormSubmitHandler = async (event) => {
    event.preventDefault();
    if (!clientId) { setError("Choose or add a client before saving."); return; }
    if (!invoiceNumber.trim()) { setError("Enter a document number before saving."); return; }
    if (lineItems.some((item) => !item.description.trim())) { setError("Each line item needs a description."); return; }
    setIsSaving(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const data: Document = {
      id, invoiceNumber: invoiceNumber.trim(), documentType, clientId, status: "draft", issueDate,
      dueDate: dueDate || null, currency, lineItems, subtotalCents, taxAmountCents, totalCents,
      paymentReceived: false, paymentReceivedDate: null, attachments: [], notes: notes || null,
    };
    try {
      await createDocument({ id, recordKind: "document", createdAt: timestamp, updatedAt: timestamp, data });
      await onCreated();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the document.");
    } finally { setIsSaving(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="editor-header"><div><p className="eyebrow">New document</p><h2 id="editor-title">Invoice or quote</h2></div><button className="close-button" type="button" aria-label="Close editor" onClick={onClose}>X</button></header>
      <form onSubmit={saveDocument}>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="editor-grid">
          <label>Type<div className="type-toggle"><button className={documentType === "invoice" ? "selected" : ""} type="button" onClick={() => setDocumentType("invoice")}>Invoice</button><button className={documentType === "quote" ? "selected" : ""} type="button" onClick={() => setDocumentType("quote")}>Quote</button></div></label>
          <label>Document number<input required value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="INV-2026-001" /></label>
          <label>Client<select required value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.data.name}</option>)}</select></label>
          <button className="link-button" type="button" onClick={() => setIsAddingClient((value) => !value)}>{isAddingClient ? "Cancel new client" : "Add new client"}</button>
          {isAddingClient && <div className="new-client"><input value={newClientName} onChange={(event) => setNewClientName(event.target.value)} placeholder="Client name" /><button type="button" onClick={() => void addClient()}>Add</button></div>}
          <label>Issue date<input required type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></label>
          <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option></select></label>
        </div>
        <div className="line-items"><div className="line-items-heading"><h3>Line items</h3><button className="link-button" type="button" onClick={() => setLineItems((current) => [...current, emptyLineItem()])}>Add line</button></div>
          {lineItems.map((item, index) => <div className="line-item" key={index}>
            <input aria-label={`Description ${index + 1}`} value={item.description} onChange={(event) => updateLineItem(index, { description: event.target.value })} placeholder="Description" />
            <input aria-label={`Quantity ${index + 1}`} type="number" min="0.001" step="0.001" value={item.quantityMilliunits / 1000} onChange={(event) => updateLineItem(index, { quantityMilliunits: Math.round((Number(event.target.value) || 0) * 1000) })} />
            <input aria-label={`Unit price ${index + 1}`} type="number" min="0" step="0.01" value={item.unitPriceCents / 100} onChange={(event) => updateLineItem(index, { unitPriceCents: centsFromInput(event.target.value) })} />
            <input aria-label={`Tax rate ${index + 1}`} type="number" min="0" step="0.01" value={item.taxRateBasisPoints / 100} onChange={(event) => updateLineItem(index, { taxRateBasisPoints: Math.round((Number(event.target.value) || 0) * 100) })} />
            <button className="remove-button" type="button" aria-label={`Remove line ${index + 1}`} disabled={lineItems.length === 1} onClick={() => setLineItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
          </div>)}
        </div>
        <label className="notes-field">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <div className="editor-footer"><dl><div><dt>Subtotal</dt><dd>{(subtotalCents / 100).toFixed(2)} {currency}</dd></div><div><dt>Tax</dt><dd>{(taxAmountCents / 100).toFixed(2)} {currency}</dd></div><div><dt>Total</dt><dd>{(totalCents / 100).toFixed(2)} {currency}</dd></div></dl><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : `Save ${documentType}`}</button></div>
      </form>
    </section>
  </div>;
}

export default DocumentEditor;