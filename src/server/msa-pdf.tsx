// Renders an MsaContent snapshot to a PDF buffer using @react-pdf/renderer
// (pure Node PDF generation — no headless browser/Chromium dependency,
// which matters because this runs in a Vercel serverless function). Used
// for both the plain "upload to Adobe Acrobat Sign / DocuSign" export and,
// with a signature block appended, the record of an in-house typed-name
// signature.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { MsaContent } from "./msa";
import { renderMsaSections } from "./msa";
import { LOCKDOWN_LOGO_DATA_URI } from "./msa-pdf-assets";

// Brand palette sampled directly from public/lockdown-logo.png (navy +
// bright blue), used here instead of the generic slate/amber this PDF used
// before, so the downloadable MSA actually looks like it came from this
// business.
const BRAND_NAVY = "#024996";
const BRAND_BLUE = "#1d98eb";
const BRAND_GRAY = "#64748b";

const styles = StyleSheet.create({
  page: { padding: 48, paddingTop: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1e293b" },
  logo: { width: 160, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2, color: BRAND_NAVY },
  subtitle: { fontSize: 10, color: BRAND_GRAY, marginBottom: 16 },
  banner: {
    backgroundColor: "#eaf4fd",
    borderLeftWidth: 3,
    borderLeftColor: BRAND_BLUE,
    padding: 8,
    marginBottom: 16,
    fontSize: 8.5,
    color: BRAND_NAVY,
  },
  heading: { fontSize: 11, fontWeight: 700, marginTop: 14, marginBottom: 4, color: BRAND_NAVY },
  paragraph: { marginBottom: 6, lineHeight: 1.4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#cbd5e1", paddingVertical: 4 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: BRAND_BLUE, paddingVertical: 4 },
  tableCell: { flex: 1, fontSize: 8.5, paddingRight: 4 },
  tableCellHeader: { flex: 1, fontSize: 8.5, fontWeight: 700, paddingRight: 4, color: BRAND_NAVY },
  signatureBlock: { marginTop: 24, borderTopWidth: 1, borderTopColor: BRAND_BLUE, paddingTop: 12 },
  signatureColumns: { flexDirection: "row" },
  signatureColumn: { flex: 1, marginRight: 24 },
  signatureColumnLabel: { fontSize: 9, fontWeight: 700, color: BRAND_NAVY, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  signatureRow: { marginBottom: 9 },
  signatureRowLabel: { fontSize: 7.5, color: BRAND_GRAY, marginBottom: 1 },
  signatureRowValue: { fontSize: 9.5, borderBottomWidth: 0.75, borderBottomColor: "#94a3b8", paddingBottom: 3, minHeight: 14 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 7.5, color: BRAND_GRAY, textAlign: "center" },
  contactBlock: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#eaf4fd",
    borderLeftWidth: 3,
    borderLeftColor: BRAND_BLUE,
    padding: 8,
    marginBottom: 16,
  },
  contactPhoto: { width: 32, height: 32, borderRadius: 16, marginRight: 8 },
  contactInitials: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    backgroundColor: BRAND_NAVY,
    color: "#ffffff",
    fontSize: 11,
    fontWeight: 700,
    textAlign: "center",
    paddingTop: 9,
  },
  contactLabel: { fontSize: 7, fontWeight: 700, color: BRAND_NAVY, textTransform: "uppercase", letterSpacing: 0.5 },
  contactName: { fontSize: 9.5, fontWeight: 700, color: "#0f172a" },
  contactDetail: { fontSize: 8, color: BRAND_GRAY },
});

function MsaDocument({
  content,
  signature,
}: {
  content: MsaContent;
  signature?: { signedByName: string; signedByTitle: string | null; signedAt: string; signedIp: string | null } | null;
}) {
  const sections = renderMsaSections(content);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Image src={LOCKDOWN_LOGO_DATA_URI} style={styles.logo} />
        <Text style={styles.title}>Master Service Agreement</Text>
        <Text style={styles.subtitle}>
          Quote #{content.quoteNumber} · {content.customerName} · Generated {new Date(content.generatedAt).toLocaleDateString()}
        </Text>
        {content.accountContact && (
          <View style={styles.contactBlock}>
            {content.accountContact.photoUrl ? (
              <Image src={content.accountContact.photoUrl} style={styles.contactPhoto} />
            ) : (
              <Text style={styles.contactInitials}>
                {content.accountContact.name
                  .split(/\s+/)
                  .map((p) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "?"}
              </Text>
            )}
            <View>
              <Text style={styles.contactLabel}>Your point of contact</Text>
              <Text style={styles.contactName}>
                {content.accountContact.name}
                {content.accountContact.title ? ` — ${content.accountContact.title}` : ""}
              </Text>
              <Text style={styles.contactDetail}>
                {[content.accountContact.email, content.accountContact.phone].filter(Boolean).join("   ·   ")}
              </Text>
            </View>
          </View>
        )}

        {sections.map((section) => (
          <View key={section.heading}>
            <Text style={styles.heading}>{section.heading}</Text>
            {section.paragraphs.map((p, i) => (
              <Text key={i} style={styles.paragraph}>
                {p}
              </Text>
            ))}
            {section.table && (
              <View>
                <View style={styles.tableHeaderRow}>
                  {section.table.headers.map((h) => (
                    <Text key={h} style={styles.tableCellHeader}>
                      {h}
                    </Text>
                  ))}
                </View>
                {section.table.rows.map((row, ri) => (
                  <View key={ri} style={styles.tableRow}>
                    {row.map((cell, ci) => (
                      <Text key={ci} style={styles.tableCell}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}

        <View style={styles.signatureBlock}>
          <View style={styles.signatureColumns}>
            <View style={styles.signatureColumn}>
              <Text style={styles.signatureColumnLabel}>Provider — {content.msaSettings.providerLegalName || "[Provider legal name]"}</Text>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Signature</Text>
                <Text style={styles.signatureRowValue}> </Text>
              </View>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Name</Text>
                <Text style={styles.signatureRowValue}>{content.msaSettings.providerSignerName || " "}</Text>
              </View>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Title</Text>
                <Text style={styles.signatureRowValue}>{content.msaSettings.providerSignerTitle || " "}</Text>
              </View>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Date</Text>
                <Text style={styles.signatureRowValue}> </Text>
              </View>
            </View>

            <View style={styles.signatureColumn}>
              <Text style={styles.signatureColumnLabel}>Client — {content.customerName}</Text>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Signature{signature ? " (typed)" : ""}</Text>
                <Text style={styles.signatureRowValue}>{signature ? signature.signedByName : " "}</Text>
              </View>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Name</Text>
                <Text style={styles.signatureRowValue}>{signature ? signature.signedByName : " "}</Text>
              </View>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Title</Text>
                <Text style={styles.signatureRowValue}>{signature?.signedByTitle || " "}</Text>
              </View>
              <View style={styles.signatureRow}>
                <Text style={styles.signatureRowLabel}>Date</Text>
                <Text style={styles.signatureRowValue}>{signature ? new Date(signature.signedAt).toLocaleString() : " "}</Text>
              </View>
              {signature?.signedIp && (
                <Text style={{ fontSize: 7, color: BRAND_GRAY }}>Submitted from IP {signature.signedIp}</Text>
              )}
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          {signature
            ? "Signed electronically via typed name — not a certified/notarized digital signature. Retain for your records."
            : "Unsigned template — upload to Adobe Acrobat Sign, DocuSign, or your e-signature provider of choice to route for signature, or use this system's own signing link."}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderMsaPdf(
  content: MsaContent,
  signature?: { signedByName: string; signedByTitle: string | null; signedAt: string; signedIp: string | null } | null
): Promise<Buffer> {
  return renderToBuffer(<MsaDocument content={content} signature={signature ?? null} />);
}
