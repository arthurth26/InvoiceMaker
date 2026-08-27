import { Document as PdfDocument, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Client, CompanyInfo, Document } from "../types/invoice";

interface InvoicePdfProps {
  company: CompanyInfo;
  client: Client | null;
  document: Document;
}

const styles = StyleSheet.create({
  page: { backgroundColor: "#ffffff", color: "#121212", fontFamily: "Helvetica", fontSize: 10, padding: 48 },
  header: { alignItems: "flex-start", borderBottomColor: "#121212", borderBottomWidth: 2, flexDirection: "row", justifyContent: "space-between", paddingBottom: 20 },
  wordmark: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  companyDetails: { color: "#444444", lineHeight: 1.45, marginTop: 7, maxWidth: 230 },
  documentLabel: { fontFamily: "Helvetica-Bold", fontSize: 26, textAlign: "right" },
  documentNumber: { fontSize: 11, marginTop: 7, textAlign: "right" },
  dates: { color: "#444444", lineHeight: 1.45, marginTop: 15, textAlign: "right" },
  billing: { flexDirection: "row", justifyContent: "space-between", marginTop: 28 },
  billingColumn: { width: "46%" },
  label: { color: "#666666", fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 6 },
  recipient: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 4 },
  details: { color: "#444444", lineHeight: 1.45 },
  table: { marginTop: 34 },
  tableHeader: { backgroundColor: "#121212", color: "#ffffff", flexDirection: "row", fontFamily: "Helvetica-Bold", fontSize: 8, padding: 8 },
  row: { borderBottomColor: "#d4d4d4", borderBottomWidth: 1, flexDirection: "row", minHeight: 34, paddingVertical: 8 },
  description: { width: "46%" },
  quantity: { textAlign: "right", width: "14%" },
  rate: { textAlign: "right", width: "18%" },
  amount: { textAlign: "right", width: "22%" },
  totals: { alignSelf: "flex-end", marginTop: 24, width: "43%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  total: { borderTopColor: "#121212", borderTopWidth: 2, fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 4, paddingTop: 8 },
  notes: { borderTopColor: "#d4d4d4", borderTopWidth: 1, marginTop: 42, paddingTop: 14 },
  footer: { bottom: 34, color: "#666666", fontSize: 8, left: 48, position: "absolute", right: 48, textAlign: "center" },
});

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { currency, style: "currency" }).format(cents / 100);
}

function formatQuantity(quantityMilliunits: number) {
  return (quantityMilliunits / 1000).toString();
}

function contactDetails(name: string, address: string, email: string, phone: string, taxId: string | null) {
  return [name, address, email, phone, taxId ? `Tax ID: ${taxId}` : null].filter(Boolean).join("\n");
}

function InvoicePdf({ company, client, document }: InvoicePdfProps) {
  const label = document.documentType === "invoice" ? "INVOICE" : "QUOTE";
  const clientDetails = client
    ? contactDetails(client.name, client.address, client.email, client.phone, client.taxId)
    : "Client details unavailable";

  return <PdfDocument title={document.invoiceNumber} author={company.name}>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>{company.name || "YOUR COMPANY"}</Text>
          <Text style={styles.companyDetails}>{contactDetails("", company.address, company.email, company.phone, company.taxId)}</Text>
        </View>
        <View>
          <Text style={styles.documentLabel}>{label}</Text>
          <Text style={styles.documentNumber}>{document.invoiceNumber}</Text>
          <Text style={styles.dates}>Issued {document.issueDate}{document.dueDate ? `\nDue ${document.dueDate}` : ""}</Text>
        </View>
      </View>

      <View style={styles.billing}>
        <View style={styles.billingColumn}>
          <Text style={styles.label}>BILL TO</Text>
          <Text style={styles.recipient}>{client?.name || "Client"}</Text>
          <Text style={styles.details}>{clientDetails.replace(`${client?.name || ""}\n`, "")}</Text>
        </View>
        <View style={styles.billingColumn}>
          <Text style={styles.label}>STATUS</Text>
          <Text style={styles.recipient}>{document.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.table}>
        <View style={styles.tableHeader}><Text style={styles.description}>DESCRIPTION</Text><Text style={styles.quantity}>QTY</Text><Text style={styles.rate}>RATE</Text><Text style={styles.amount}>AMOUNT</Text></View>
        {document.lineItems.map((item, index) => {
          const amount = Math.round(item.quantityMilliunits * item.unitPriceCents / 1000) - item.discountCents;
          return <View key={index} style={styles.row} wrap={false}>
            <Text style={styles.description}>{item.description}</Text>
            <Text style={styles.quantity}>{formatQuantity(item.quantityMilliunits)}</Text>
            <Text style={styles.rate}>{formatMoney(item.unitPriceCents, document.currency)}</Text>
            <Text style={styles.amount}>{formatMoney(amount, document.currency)}</Text>
          </View>;
        })}
      </View>

      <View style={styles.totals}>
        <View style={styles.totalRow}><Text>Subtotal</Text><Text>{formatMoney(document.subtotalCents, document.currency)}</Text></View>
        <View style={styles.totalRow}><Text>Tax</Text><Text>{formatMoney(document.taxAmountCents, document.currency)}</Text></View>
        <View style={[styles.totalRow, styles.total]}><Text>Total</Text><Text>{formatMoney(document.totalCents, document.currency)}</Text></View>
      </View>

      {document.notes && <View style={styles.notes}><Text style={styles.label}>NOTES</Text><Text style={styles.details}>{document.notes}</Text></View>}
      <Text fixed style={styles.footer}>{company.name || "Invoice Maker"} | {document.invoiceNumber}</Text>
    </Page>
  </PdfDocument>;
}

export default InvoicePdf;