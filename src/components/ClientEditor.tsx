import { useState } from "react";
import type { ComponentProps } from "react";

import { saveClient } from "../services/invoiceRepository";
import type { Client, StoredRecord } from "../types/invoice";

interface ClientEditorProps {
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;

function ClientEditor({ onClose, onSaved }: ClientEditorProps) {
  const [client, setClient] = useState<Omit<Client, "id">>({ name: "", address: "", email: "", phone: "", taxId: null });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const saveNewClient: FormSubmitHandler = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: StoredRecord<Client> = { id, recordKind: "client", createdAt: timestamp, updatedAt: timestamp, data: { id, ...client } };
    try {
      await saveClient(record);
      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the new client.");
    } finally { setIsSaving(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-editor-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="editor-header"><div><p className="eyebrow">New client</p><h2 id="client-editor-title">Client details</h2></div><button className="close-button" type="button" aria-label="Close client editor" onClick={onClose}>X</button></header>
      <form className="client-form" onSubmit={saveNewClient}>
        {error && <p className="notice error" role="alert">{error}</p>}
        <label>Name<input required value={client.name} onChange={(event) => setClient({ ...client, name: event.target.value })} /></label>
        <label>Email<input type="email" value={client.email} onChange={(event) => setClient({ ...client, email: event.target.value })} /></label>
        <label>Phone<input value={client.phone} onChange={(event) => setClient({ ...client, phone: event.target.value })} /></label>
        <label>Tax ID<input value={client.taxId ?? ""} onChange={(event) => setClient({ ...client, taxId: event.target.value || null })} /></label>
        <label className="wide-field">Address<textarea rows={3} value={client.address} onChange={(event) => setClient({ ...client, address: event.target.value })} /></label>
        <div className="form-actions"><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save client"}</button></div>
      </form>
    </section>
  </div>;
}

export default ClientEditor;