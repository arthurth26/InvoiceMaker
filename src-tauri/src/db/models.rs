use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordKind {
    Company,
    Client,
    Document,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentType {
    Quote,
    Invoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentStatus {
    Draft,
    Sent,
    Accepted,
    Invoiced,
    Paid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyInfo {
    pub name: String,
    pub address: String,
    pub email: String,
    pub phone: String,
    pub tax_id: String,
    pub logo_path: Option<String>,
    pub default_currency: String,
    pub output_directory: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub id: String,
    pub name: String,
    pub address: String,
    pub email: String,
    pub phone: String,
    pub tax_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub relative_path: String,
    pub original_filename: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineItem {
    pub description: String,
    pub quantity_milliunits: i64,
    pub unit_price_cents: i64,
    pub tax_rate_basis_points: i32,
    pub discount_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub invoice_number: String,
    pub document_type: DocumentType,
    pub client_id: String,
    pub status: DocumentStatus,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub currency: String,
    pub line_items: Vec<LineItem>,
    pub subtotal_cents: i64,
    pub tax_amount_cents: i64,
    pub total_cents: i64,
    pub payment_received: bool,
    pub payment_received_date: Option<String>,
    pub attachments: Vec<Attachment>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecord<T> {
    pub id: String,
    pub record_kind: RecordKind,
    pub created_at: String,
    pub updated_at: String,
    pub data: T,
}

#[cfg(test)]
mod tests {
    use super::{DocumentStatus, DocumentType};

    #[test]
    fn document_enums_use_database_values() {
        assert_eq!(
            serde_json::to_string(&DocumentType::Invoice).unwrap(),
            "\"invoice\""
        );
        assert_eq!(
            serde_json::to_string(&DocumentStatus::Paid).unwrap(),
            "\"paid\""
        );
    }
}
