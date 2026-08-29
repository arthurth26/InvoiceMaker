use rusqlite::{Connection, Result};

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    sql: r#"
		CREATE TABLE records (
			id TEXT PRIMARY KEY NOT NULL,
			record_kind TEXT NOT NULL CHECK (record_kind IN ('company', 'client', 'document')),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			data_json TEXT NOT NULL,
			invoice_number TEXT UNIQUE,
			document_type TEXT CHECK (document_type IN ('quote', 'invoice') OR document_type IS NULL),
			client_id TEXT,
			status TEXT,
			issue_date TEXT,
			due_date TEXT,
			currency TEXT,
			subtotal_cents INTEGER,
			tax_amount_cents INTEGER,
			total_cents INTEGER,
			payment_received INTEGER CHECK (payment_received IN (0, 1) OR payment_received IS NULL),
			payment_received_date TEXT,
			CHECK (
				record_kind = 'document'
				OR (
					invoice_number IS NULL
					AND document_type IS NULL
					AND client_id IS NULL
					AND status IS NULL
					AND issue_date IS NULL
					AND due_date IS NULL
					AND currency IS NULL
					AND subtotal_cents IS NULL
					AND tax_amount_cents IS NULL
					AND total_cents IS NULL
					AND payment_received IS NULL
					AND payment_received_date IS NULL
				)
			)
		);

		CREATE INDEX records_document_list_idx
			ON records (record_kind, issue_date, status, client_id);
	"#,
}];

pub fn migrate(connection: &mut Connection) -> Result<()> {
    let current_version = current_version(connection)?;

    if current_version > MIGRATIONS.len() as u32 {
        return Err(rusqlite::Error::InvalidQuery);
    }

    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current_version)
    {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.pragma_update(None, "user_version", migration.version)?;
        transaction.commit()?;
    }

    Ok(())
}

pub fn has_pending_migrations(connection: &Connection) -> Result<bool> {
    Ok(current_version(connection)? < MIGRATIONS.len() as u32)
}

fn current_version(connection: &Connection) -> Result<u32> {
    let current_version: u32 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current_version > MIGRATIONS.len() as u32 {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(current_version)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::migrate;

    #[test]
    fn creates_the_initial_records_schema_once() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");

        migrate(&mut connection).expect("apply initial migration");
        migrate(&mut connection).expect("skip already applied migration");

        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("read schema version");
        let records_table_exists: bool = connection
			.query_row(
				"SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'records')",
				[],
				|row| row.get(0),
			)
			.expect("find records table");

        assert_eq!(version, 1);
        assert!(records_table_exists);
    }
}
