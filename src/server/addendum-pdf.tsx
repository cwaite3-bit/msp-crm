// Renders an AddendumContent snapshot to a PDF buffer, mirroring
// msa-pdf.tsx's structure/branding exactly (same fonts, colors, table and
// signature-block styling) so a signed addendum looks like it belongs with
// the MSA it amends, just shorter.
import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { AddendumContent } from "./addendum";
import { renderAddendumSections } from "./addendum";
import { LOCKDOWN_LOGO_DATA_URI } from "./msa-pdf-assets";
import { BRAND_NAVY, BRAND_BLUE, BRAND_GRAY } from "./msa-pdf";
import type { MsaSignatureInfo } from "./msa-pdf";

const styles = StyleSheet.create({
  page: { padding: 48, paddingTop: 32, fontSize: 10, fontFamily: "Helvetica", color: "#1e293b" },
  logo: { width: 160, marginBottom: 16 },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2, color: BRAND_NAVY },
  subtitle: { fontSize: 10, color: BRAND_GRAY, marginBottom: 16 },
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
  signatureImageWrap: {
    borderBottomWidth: 0.75,
    borderBottomColor: "#94a3b8",
    paddingBottom: 3,
    minHeight: 14,
    justifyContent: "flex-end",
  },
  signatureImage: { height: 26, width: 110, objectFit: "contain" },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 7.5, color: BRAND_GRAY, textAlign: "center" },
});

function AddendumDocument({ content, signature }: { content: AddendumContent; signature?: MsaSignatureInfo | null }) {
  const sections = renderAddendumSections(content);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Image src={LOCKDOWN_LOGO_DATA_URI} style={styles.logo} />
        <Text style={styles.title}>Addendum No. {content.addendumNumber} to the Master Service Agreement</Text>
        <Text style={styles.subtitle}>
          Quote #{content.quoteNumber} · {content.customerName} · Generated {new Date(content.generatedAt).toLocaleDateString()}
        </Text>

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
                <Text style={styles.signatureRowLabel}>
                  Signature{signature ? (signature.signatureImageUrl ? " (drawn)" : " (typed)") : ""}
                </Text>
                {signature?.signatureImageUrl ? (
                  <View style={styles.signatureImageWrap}>
                    <Image src={signature.signatureImageUrl} style={styles.signatureImage} />
                  </View>
                ) : (
                  <Text style={styles.signatureRowValue}>{signature ? signature.signedByName : " "}</Text>
                )}
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
              {signature?.signedIp && <Text style={{ fontSize: 7, color: BRAND_GRAY }}>Submitted from IP {signature.signedIp}</Text>}
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          {signature
            ? `Signed electronically via ${signature.signatureImageUrl ? "a drawn signature" : "a typed name"}, with the signer's IP address logged — not a certified/notarized digital signature. Retain for your records.`
            : "Unsigned template — upload to Adobe Acrobat Sign, DocuSign, or your e-signature provider of choice to route for signature, or use this system's own signing link."}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderAddendumPdf(content: AddendumContent, signature?: MsaSignatureInfo | null): Promise<Buffer> {
  return renderToBuffer(<AddendumDocument content={content} signature={signature ?? null} />);
}
