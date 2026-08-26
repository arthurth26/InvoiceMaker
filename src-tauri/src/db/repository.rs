use std::fmt;

use rusqlite::{params, Connection, OptionalExtension};

use super::models::{
	Client, CompanyInfo, Document, DocumentStatus, DocumentType, RecordKind, StoredRecord,
};

const COMPANY_RECORD_ID: &str = "company";

#[derive(Debug)]
pub enum RepositoryError {
	Database(rusqlite::Error),
	Serialization(serde_json::Error),
	DocumentNotFound,
	PaidDocumentLocked,
	InvalidRecordId,
	InconsistentPaymentStatus,
}

impl fmt::Display for RepositoryError {
	fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Database(error) => write!(formatter, "database error: {error}"),
			Self::Serialization(error) => write!(formatter, "serialization error: {error}"),
			Self::DocumentNotFound => write!(formatter, "document not found"),
			Self::PaidDocumentLocked => write!(formatter, "paid documents cannot be edited"),
			Self::InvalidRecordId => write!(formatter, "record ID does not match its data"),
			Self::InconsistentPaymentStatus => {
				write!(formatter, "paid status must match the payment received flag")
			}
		}
	}
}

impl std::error::Error for RepositoryError {}

impl From<rusqlite::Error> for RepositoryError {
	fn from(error: rusqlite::Error) -> Self {
		Self::Database(error)
	}
}

impl From<serde_json::Error> for RepositoryError {
	fn from(error: serde_json::Error) -> Self {
		Self::Serialization(error)
	}
}

pub type RepositoryResult<T> = Result<T, RepositoryError>;

pub struct Repository<'connection> {
	connection: &'connection Connection,
}

impl<'connection> Repository<'connection> {
	pub fn new(connection: &'connection Connection) -> Self {
		Self { connection }
	}

	pub fn upsert_company(&self, record: &StoredRecord<CompanyInfo>) -> RepositoryResult<()> {
		if record.id != COMPANY_RECORD_ID {
			return Err(RepositoryError::InvalidRecordId);
		}

		let data_json = serde_json::to_string(&record.data)?;
		self.connection.execute(
			"INSERT INTO records (id, record_kind, created_at, updated_at, data_json)
			 VALUES (?1, 'company', ?2, ?3, ?4)
			 ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data_json = excluded.data_json",
			params![record.id, record.created_at, record.updated_at, data_json],
		)?;
		Ok(())
	}

	pub fn upsert_client(&self, record: &StoredRecord<Client>) -> RepositoryResult<()> {
		if record.id != record.data.id {
			return Err(RepositoryError::InvalidRecordId);
		}

		let data_json = serde_json::to_string(&record.data)?;
		self.connection.execute(
			"INSERT INTO records (id, record_kind, created_at, updated_at, data_json)
			 VALUES (?1, 'client', ?2, ?3, ?4)
			 ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data_json = excluded.data_json",
			params![record.id, record.created_at, record.updated_at, data_json],
		)?;
		Ok(())
	}

	pub fn create_document(&self, record: &StoredRecord<Document>) -> RepositoryResult<()> {
		self.validate_document(record)?;
		let columns = DocumentColumns::from_record(record)?;
		self.connection.execute(
			"INSERT INTO records (
				id, record_kind, created_at, updated_at, data_json, invoice_number, document_type,
				client_id, status, issue_date, due_date, currency, subtotal_cents, tax_amount_cents,
				total_cents, payment_received, payment_received_date
			) VALUES (
				?1, 'document', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16
			)",
			params![
				record.id,
				record.created_at,
				record.updated_at,
				columns.data_json,
				record.data.invoice_number,
				columns.document_type,
				record.data.client_id,
				columns.status,
				record.data.issue_date,
				record.data.due_date,
				record.data.currency,
				record.data.subtotal_cents,
				record.data.tax_amount_cents,
				record.data.total_cents,
				columns.payment_received,
				record.data.payment_received_date,
			],
		)?;
		Ok(())
	}

	pub fn update_document(&self, record: &StoredRecord<Document>) -> RepositoryResult<()> {
		self.validate_document(record)?;
		let columns = DocumentColumns::from_record(record)?;
		let payment_received: Option<i64> = self
			.connection
			.query_row(
				"SELECT payment_received FROM records WHERE id = ?1 AND record_kind = 'document'",
				[&record.id],
				|row| row.get(0),
			)
			.optional()?;

		match payment_received {
			Some(1) => return Err(RepositoryError::PaidDocumentLocked),
			Some(_) => {}
			None => return Err(RepositoryError::DocumentNotFound),
		}

		self.connection.execute(
			"UPDATE records SET
				updated_at = ?3, data_json = ?4, invoice_number = ?5, document_type = ?6,
				client_id = ?7, status = ?8, issue_date = ?9, due_date = ?10, currency = ?11,
				subtotal_cents = ?12, tax_amount_cents = ?13, total_cents = ?14,
				payment_received = ?15, payment_received_date = ?16
			 WHERE id = ?1 AND record_kind = 'document'",
			params![
				record.id,
				record.created_at,
				record.updated_at,
				columns.data_json,
				record.data.invoice_number,
				columns.document_type,
				record.data.client_id,
				columns.status,
				record.data.issue_date,
				record.data.due_date,
				record.data.currency,
				record.data.subtotal_cents,
				record.data.tax_amount_cents,
				record.data.total_cents,
				columns.payment_received,
				record.data.payment_received_date,
			],
		)?;
		Ok(())
	}

	pub fn get_document(&self, id: &str) -> RepositoryResult<Option<StoredRecord<Document>>> {
		let record = self
			.connection
			.query_row(
				"SELECT id, created_at, updated_at, data_json
				 FROM records WHERE id = ?1 AND record_kind = 'document'",
				[id],
				|row| {
					let data_json: String = row.get(3)?;
					let data = serde_json::from_str(&data_json).map_err(|error| {
						rusqlite::Error::FromSqlConversionFailure(
							3,
							rusqlite::types::Type::Text,
							Box::new(error),
						)
					})?;
					Ok(StoredRecord {
						id: row.get(0)?,
						record_kind: RecordKind::Document,
						created_at: row.get(1)?,
						updated_at: row.get(2)?,
						data,
					})
				},
			)
			.optional()?;
		Ok(record)
	}

	fn validate_document(&self, record: &StoredRecord<Document>) -> RepositoryResult<()> {
		if record.id != record.data.id || record.record_kind != RecordKind::Document {
			return Err(RepositoryError::InvalidRecordId);
		}
		if (record.data.status == DocumentStatus::Paid) != record.data.payment_received {
			return Err(RepositoryError::InconsistentPaymentStatus);
		}
		Ok(())
	}
}

struct DocumentColumns {
	data_json: String,
	document_type: &'static str,
	status: &'static str,
	payment_received: i64,
}

impl DocumentColumns {
	fn from_record(record: &StoredRecord<Document>) -> RepositoryResult<Self> {
		let document_type = match record.data.document_type {
			DocumentType::Quote => "quote",
			DocumentType::Invoice => "invoice",
		};
		let status = match record.data.status {
			DocumentStatus::Draft => "draft",
			DocumentStatus::Sent => "sent",
			DocumentStatus::Accepted => "accepted",
			DocumentStatus::Invoiced => "invoiced",
			DocumentStatus::Paid => "paid",
		};

		Ok(Self {
			data_json: serde_json::to_string(&record.data)?,
			document_type,
			status,
			payment_received: i64::from(record.data.payment_received),
		})
	}
}

#[cfg(test)]
mod tests {
	use rusqlite::Connection;

	use crate::db::{
		migrations::migrate,
		models::{Document, DocumentStatus, DocumentType, RecordKind, StoredRecord},
	};

	use super::{Repository, RepositoryError};

	fn document_record(status: DocumentStatus, payment_received: bool) -> StoredRecord<Document> {
		StoredRecord {
			id: "document-1".to_owned(),
			record_kind: RecordKind::Document,
			created_at: "2026-08-26T10:00:00Z".to_owned(),
			updated_at: "2026-08-26T10:00:00Z".to_owned(),
			data: Document {
				id: "document-1".to_owned(),
				invoice_number: "INV-2026-001".to_owned(),
				document_type: DocumentType::Invoice,
				client_id: "client-1".to_owned(),
				status,
				issue_date: "2026-08-26".to_owned(),
				due_date: None,
				currency: "USD".to_owned(),
				line_items: Vec::new(),
				subtotal_cents: 1_000,
				tax_amount_cents: 100,
				total_cents: 1_100,
				payment_received,
				payment_received_date: Some("2026-08-26".to_owned()),
				attachments: Vec::new(),
				notes: None,
			},
		}
	}

	#[test]
	fn paid_documents_can_be_read_but_not_updated() {
		let mut connection = Connection::open_in_memory().expect("open in-memory database");
		migrate(&mut connection).expect("apply migration");
		let repository = Repository::new(&connection);
		let mut record = document_record(DocumentStatus::Paid, true);

		repository.create_document(&record).expect("create paid document");
		assert_eq!(
			repository
				.get_document("document-1")
				.expect("read document")
				.expect("document exists"),
			record
		);

		record.data.notes = Some("Attempted edit".to_owned());
		let error = repository
			.update_document(&record)
			.expect_err("paid document should be locked");

		assert!(matches!(error, RepositoryError::PaidDocumentLocked));
	}

	#[test]
	fn rejects_inconsistent_payment_status() {
		let mut connection = Connection::open_in_memory().expect("open in-memory database");
		migrate(&mut connection).expect("apply migration");
		let repository = Repository::new(&connection);

		for record in [
			document_record(DocumentStatus::Paid, false),
			document_record(DocumentStatus::Sent, true),
		] {
			let error = repository
				.create_document(&record)
				.expect_err("inconsistent payment status should be rejected");
			assert!(matches!(error, RepositoryError::InconsistentPaymentStatus));
		}
	}
}
