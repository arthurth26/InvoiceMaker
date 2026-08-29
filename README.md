# Invoice Maker

Invoice Maker is a local-first desktop application for creating invoices and quotations. It is built with Tauri, React, TypeScript, and SQLite, and runs as a native Windows application without requiring an external server or cloud account.

## Features

- Save a company profile with contact details, logo path, default currency, and PDF output directory.
- Create and manage clients locally.
- Create invoices and quotes with a generated sequential number in the format `INV-YYYY-###-00`.
- Edit document details, client, dates, currency, notes, and line items.
- Duplicate an existing document to start a new one from its details.
- Automatically calculate and persist document subtotal, tax amount, and total in cents.
- Generate a PDF when saving a new invoice, and save PDFs on demand from the document list.
- Filter, sort, paginate, and export the currently filtered invoice/quote list as a UTF-8 BOM CSV file compatible with Excel.
- Update unpaid document statuses between `draft`, `sent`, and `accepted`.
- Mark a document as paid by selecting a payment-proof file. The proof is copied into local app storage and the paid document becomes locked for editing.
- Open the stored payment proof directly from the document list.
- Delete a document after confirmation. A timestamped database backup is created before deletion.
- Create manual consistent SQLite backups, choose a separate automatic-backup directory, and restore a backup. Restoring first backs up the active database and restarts the application.

## Storage and Data Safety

All application data is stored locally in Tauri's application-local data directory:

- `invoicemaker.db` is the SQLite database.
- `invoices/<document-id>/` contains copied payment-proof files.
- `backup-directory.txt` stores the optional automatic-backup directory selected in the app.

The database uses one `records` table for company, client, and document records. Document line items and attachment references are stored as JSON, while invoice number, status, dates, currency, subtotal, tax amount, total, and payment fields are stored in dedicated columns for reporting.

Schema migrations run at startup using SQLite's `user_version`. When an existing database has a pending migration, the application creates a timestamped `invoicemaker-before-migration-*.db` backup before applying it. Other safety backups are also created before document deletion, client replacement on an ID collision, and database restoration.

Manual backups use `VACUUM INTO` to create a standalone consistent SQLite database. Restoring a backup replaces the open database contents only after confirmation, preserves a pre-restore backup, then restarts the application so it reopens the restored database safely.

## Document Lifecycle

Documents support these statuses: `draft`, `sent`, `accepted`, `invoiced`, and `paid`.

The dashboard exposes `draft`, `sent`, and `accepted` for unpaid documents. Selecting payment proof and marking a document paid records the payment date, stores the proof, and locks the document against further editing. Quotes and invoices share the same local document model.

## Tech Stack

- Tauri 2 and Rust
- React 19, TypeScript, and Vite
- SQLite through `rusqlite`
- `@react-pdf/renderer` for PDF generation
- Tauri dialog and opener plugins for native file workflows
- Bun for package management and scripts

## Requirements

- [Bun](https://bun.sh/)
- Rust stable and the platform prerequisites required by [Tauri v2](https://v2.tauri.app/start/prerequisites/)
- On Windows, Microsoft C++ Build Tools and WebView2 Runtime

## Development

Install dependencies:

```powershell
bun install
```

Run the browser-only Vite frontend:

```powershell
bun run dev
```

Run the native Tauri desktop application:

```powershell
bun tauri dev
```

Build the frontend bundle:

```powershell
bun run build
```

Create a native application bundle:

```powershell
bun tauri build
```

## Quality Checks

```powershell
bun run lint
bun run fmt:check
cargo test --manifest-path src-tauri/Cargo.toml
```

## Project Structure

```text
src/
	App.tsx                       Dashboard, company settings, exports, and backups
	components/
		ClientEditor.tsx             Client editor modal
		DocumentEditor.tsx           Invoice and quote editor modal
		InvoicePdf.tsx               React PDF document layout
	services/invoiceRepository.ts Tauri command wrappers
	types/invoice.ts               Shared data model types
src-tauri/
	src/
		commands.rs                  Frontend-invokable Tauri commands
		db/
			migrations.rs              Versioned SQLite schema migrations
			models.rs                  Rust data model types
			repository.rs              SQLite record persistence
			mod.rs                     Database lifecycle, backups, files, and proofs
```

## Current Scope

This application is intended for local document management and record keeping. Tax values are represented in the persisted model for future reporting support; the current document editor calculates totals from quantity, unit price, and discount, with tax currently set to zero. Accounting and tax treatment should be verified for the applicable jurisdiction.
