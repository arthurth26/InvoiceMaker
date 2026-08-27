import { FormEvent, useEffect, useState } from "react";

import { getCompany, listDocuments, saveCompany } from "./services/invoiceRepository";
import type { CompanyInfo, StoredRecord } from "./types/invoice";
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadDashboard(); }, []);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);
    try {
      const [savedCompany, savedDocuments] = await Promise.all([getCompany(), listDocuments()]);
      setCompanyRecord(savedCompany);
      setCompany(savedCompany?.data ?? defaultCompany);
      setDocuments(savedDocuments);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Local ledger</p><h1>Invoice Maker</h1></div>
        <button className="refresh-button" type="button" onClick={() => void loadDashboard()}>Refresh</button>
      </header>
      {error && <p className="notice error" role="alert">{error}</p>}

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
        <div className="section-heading"><div><p className="eyebrow">Documents</p><h2 id="documents-heading">Invoices and quotes</h2></div><span className="document-count">{documents.length} total</span></div>
        {isLoading ? <p className="empty-state">Loading local records...</p> : documents.length === 0 ? <p className="empty-state">No invoices or quotes yet.</p> : (
          <div className="table-wrap"><table><thead><tr><th>Number</th><th>Type</th><th>Issue date</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead><tbody>
            {documents.map(({ id, data }) => <tr key={id}><td>{data.invoiceNumber}</td><td>{data.documentType}</td><td>{data.issueDate}</td><td><span className={`status ${data.status}`}>{data.status}</span></td><td>{data.paymentReceived ? data.paymentReceivedDate ?? "Received" : "Outstanding"}</td><td>{formatMoney(data.totalCents, data.currency)}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
    </main>
  );
}

export default App;
