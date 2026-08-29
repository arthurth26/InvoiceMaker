import { useState } from "react";
import type { ComponentProps } from "react";
import { Pencil } from "lucide-react";

import { replaceClient, saveClient } from "../services/invoiceRepository";
import type { Client, StoredRecord } from "../types/invoice";

interface ClientEditorProps {
  clients: StoredRecord<Client>[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

type FormSubmitHandler = NonNullable<ComponentProps<"form">["onSubmit"]>;
type ClientDraft = Omit<Client, "id">;

const emptyClient = (): ClientDraft => ({ name: "", address: "", email: "", phone: "", taxId: null });

function ClientEditor({ clients, onClose, onSaved }: ClientEditorProps) {
  const [client, setClient] = useState<ClientDraft>(emptyClient);
  const [editingClient, setEditingClient] = useState<StoredRecord<Client> | null>(null);
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
      setClient(emptyClient());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save the new client.");
    } finally { setIsSaving(false); }
  };

  async function saveClientChanges() {
    if (!editingClient || !editingClient.data.name.trim()) return;
    setIsSaving(true);
    setError(null);
    const record: StoredRecord<Client> = {
      ...editingClient,
      updatedAt: new Date().toISOString(),
      data: { ...editingClient.data, name: editingClient.data.name.trim() },
    };
    try {
      await replaceClient(record);
      await onSaved();
      setEditingClient(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save client changes.");
    } finally { setIsSaving(false); }
  }

  function updateEditingClient(update: Partial<Client>) {
    setEditingClient((current) => current ? { ...current, data: { ...current.data, ...update } } : current);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="client-modal" role="dialog" aria-modal="true" aria-labelledby="client-editor-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="editor-header"><div><p className="eyebrow">Clients</p><h2 id="client-editor-title">Manage clients</h2></div><button className="close-button" type="button" aria-label="Close client manager" onClick={onClose}>X</button></header>
      <form className="client-form" onSubmit={saveNewClient}>
        {error && <p className="notice error" role="alert">{error}</p>}
        <label>Name<input required maxLength={80} value={client.name} onChange={(event) => setClient({ ...client, name: event.target.value })} /></label>
        <label>Email<input type="email" value={client.email} onChange={(event) => setClient({ ...client, email: event.target.value })} /></label>
        <label>Phone<input value={client.phone} onChange={(event) => setClient({ ...client, phone: event.target.value })} /></label>
        <label>Tax ID<input value={client.taxId ?? ""} onChange={(event) => setClient({ ...client, taxId: event.target.value || null })} /></label>
        <label className="wide-field">Address<textarea rows={3} maxLength={80} value={client.address} onChange={(event) => setClient({ ...client, address: event.target.value })} /></label>
        <div className="form-actions"><button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save client"}</button></div>
      </form>
      <section className="client-list" aria-labelledby="client-list-title">
        <h3 id="client-list-title">Saved clients</h3>
        <div className="table-wrap client-table-wrap"><table className="client-table"><thead><tr><th>ID</th><th>Name</th><th>Address</th><th>Email</th><th>Phone</th><th>Tax ID</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
          {clients.length === 0 ? <tr><td className="empty-client-row" colSpan={7}>No clients saved yet.</td></tr> : clients.map((storedClient) => {
            const isEditing = editingClient?.id === storedClient.id;
            const value = isEditing ? editingClient.data : storedClient.data;
            return <tr className={isEditing ? "editing-client-row" : ""} key={storedClient.id}>
              <td>{storedClient.id}</td>
              <td>{isEditing ? <input aria-label={`Name for ${storedClient.data.name}`} maxLength={80} required value={value.name} onChange={(event) => updateEditingClient({ name: event.target.value })} /> : value.name}</td>
              <td>{isEditing ? <textarea aria-label={`Address for ${storedClient.data.name}`} rows={3} maxLength={80} value={value.address} onChange={(event) => updateEditingClient({ address: event.target.value })} /> : value.address}</td>
              <td>{isEditing ? <input aria-label={`Email for ${storedClient.data.name}`} type="email" value={value.email} onChange={(event) => updateEditingClient({ email: event.target.value })} /> : value.email}</td>
              <td>{isEditing ? <input aria-label={`Phone for ${storedClient.data.name}`} value={value.phone} onChange={(event) => updateEditingClient({ phone: event.target.value })} /> : value.phone}</td>
              <td>{isEditing ? <input aria-label={`Tax ID for ${storedClient.data.name}`} value={value.taxId ?? ""} onChange={(event) => updateEditingClient({ taxId: event.target.value || null })} /> : value.taxId ?? "-"}</td>
              <td className="actions-cell"><div className="row-actions">{isEditing ? <><button className="primary-button client-row-save" disabled={isSaving || !value.name.trim()} type="button" onClick={() => void saveClientChanges()}>{isSaving ? "Saving..." : "Save"}</button><button className="icon-button" type="button" aria-label={`Cancel editing ${storedClient.data.name}`} title="Cancel editing" disabled={isSaving} onClick={() => setEditingClient(null)}>X</button></> : <button className="icon-button" type="button" aria-label={`Edit ${storedClient.data.name}`} title="Edit client" onClick={() => setEditingClient(storedClient)}><Pencil aria-hidden="true" size={18} /></button>}</div></td>
            </tr>;
          })}
        </tbody></table></div>
      </section>
    </section>
  </div>;
}

export default ClientEditor;