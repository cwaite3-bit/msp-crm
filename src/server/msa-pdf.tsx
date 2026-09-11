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
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 7.5, color: BRAND_GRAY, textAlign: "center" },
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
        <Text style={styles.banner}>
          This document is a template generated from the attached quote and standing agreement terms. It is provided for
          convenience only and is NOT a substitute for review by an attorney licensed in your jurisdiction before it is
          relied upon as a binding agreement.
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
          <Text style={{ marginBottom: 24 }}>
            Provider: {content.msaSettings.providerLegalName || "____________________________"} By:
            ____________________________ Name: {content.msaSettings.providerSignerName || "____________________________"} Title:{" "}
            {content.msaSettings.providerSignerTitle || "____________________________"} Date: ____________
          </Text>
          {signature ? (
            <Text>
              Client: {content.customerName} By (typed signature): {signature.signedByName}
              {signature.signedByTitle ? `, ${signature.signedByTitle}` : ""} Date:{" "}
              {new Date(signature.signedAt).toLocaleString()}
              {signature.signedIp ? ` (submitted from IP ${signature.signedIp})` : ""}
            </Text>
          ) : (
            <Text>
              Client: {content.customerName} By: ____________________________ Name: ____________________________ Title:
              ____________________________ Date: ____________
            </Text>
          )}
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
